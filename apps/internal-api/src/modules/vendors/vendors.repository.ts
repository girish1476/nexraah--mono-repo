import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

export interface VendorListFilters {
  q?: string;
  status?: string;
  branchId?: string;
}

@Injectable()
export class VendorsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  async list(filters: VendorListFilters) {
    let query = this.db
      .selectFrom('vendors')
      .innerJoin('branches', 'branches.id', 'vendors.branch_id')
      .leftJoin('trips', 'trips.vendor_id', 'vendors.id')
      .leftJoin('indents', 'indents.id', 'trips.indent_id')
      .select((eb) => [
        'vendors.id as id',
        'vendors.code as code',
        'vendors.legal_name as legalName',
        'vendors.party_type as partyType',
        'vendors.base_city as baseCity',
        'branches.name as branchName',
        'vendors.phone as phone',
        'vendors.status as status',
        'vendors.advance_pct as advancePct',
        'vendors.rating as rating',
        // Onboarding's declared count, not a count of `vendor_fleet` rows —
        // nothing populates that table yet (no truck-registration feature
        // exists), so a row-count here would show 0 for every vendor,
        // unconditionally, regardless of what onboarding collected.
        'vendors.declared_fleet_count as fleetCount',
        eb.fn.count<number>('trips.id').distinct().as('trips'),
        eb.fn
          .coalesce(eb.fn.sum<number>(sql`indents.sell_rate - trips.buy_rate`), sql<number>`0`)
          .as('marginPaise'),
      ])
      .groupBy(['vendors.id', 'branches.name']);

    if (filters.q) {
      const term = `%${filters.q}%`;
      query = query.where((eb) =>
        eb.or([eb('vendors.legal_name', 'ilike', term), eb('vendors.code', 'ilike', term)]),
      );
    }
    if (filters.status) {
      query = query.where('vendors.status', 'in', filters.status.split(','));
    }
    if (filters.branchId) {
      query = query.where('vendors.branch_id', '=', filters.branchId);
    }

    return query.orderBy('vendors.legal_name').execute();
  }

  /**
   * Carries `branchName` next to the raw row. `list()` has always joined it
   * and the detail page prints it, so a detail response without it rendered
   * "Branch: undefined" against the real API while the mock had it all along.
   */
  findById(id: string) {
    return this.db
      .selectFrom('vendors')
      .leftJoin('branches', 'branches.id', 'vendors.branch_id')
      .selectAll('vendors')
      .select('branches.name as branchName')
      .where('vendors.id', '=', id)
      .executeTakeFirst();
  }

  findByIdForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('vendors').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  findBranchByCity(city: string) {
    return this.db
      .selectFrom('branches')
      .selectAll()
      .where(sql`lower(city)`, '=', city.toLowerCase())
      .execute();
  }

  insert(
    db: DbExecutor,
    row: {
      legalName: string;
      partyType: string;
      baseCity: string;
      branchId: string;
      phone: string;
      gstin: string | null;
      altPhone: string | null;
      advancePct: number;
      source: string | null;
    },
    code: string,
  ) {
    return db
      .insertInto('vendors')
      .values({
        code,
        legal_name: row.legalName,
        party_type: row.partyType,
        base_city: row.baseCity,
        branch_id: row.branchId,
        phone: row.phone,
        gstin: row.gstin,
        alt_phone: row.altPhone,
        advance_pct: row.advancePct,
        source: row.source,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  update(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db
      .updateTable('vendors')
      .set(patch)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- KYC -----------------------------------------------------------

  /** Carries the attachment's geotag so the selfie row can say where it was taken (BR-23). */
  findKyc(vendorId: string) {
    return this.db
      .selectFrom('vendor_kyc')
      .leftJoin('attachments', 'attachments.id', 'vendor_kyc.attachment_id')
      .selectAll('vendor_kyc')
      .select(['attachments.geo_lat as geoLat', 'attachments.geo_lng as geoLng'])
      .where('vendor_kyc.vendor_id', '=', vendorId)
      .execute();
  }

  findKycOne(db: DbExecutor, vendorId: string, kind: string) {
    return db
      .selectFrom('vendor_kyc')
      .selectAll()
      .where('vendor_id', '=', vendorId)
      .where('kind', '=', kind)
      .executeTakeFirst();
  }

  /**
   * Every PAN/AADHAAR row with a photo on file but no extracted value —
   * the population left behind by the `needsReference: false` bug the
   * onboarding wizard shipped with. `attachment_id is not null` excludes
   * anything with no photo to re-key from (nothing for Compliance to open).
   * `REJECTED` excluded: that goes through a fresh upload, not a backfill.
   */
  findKycValueGaps() {
    return this.db
      .selectFrom('vendor_kyc')
      .innerJoin('vendors', 'vendors.id', 'vendor_kyc.vendor_id')
      .select([
        'vendors.id as vendorId',
        'vendors.code as vendorCode',
        'vendors.legal_name as vendorName',
        'vendor_kyc.kind as kind',
        'vendor_kyc.attachment_id as attachmentId',
        'vendor_kyc.status as status',
      ])
      .where('vendor_kyc.kind', 'in', ['PAN', 'AADHAAR'])
      .where('vendor_kyc.value_masked', 'is', null)
      .where('vendor_kyc.attachment_id', 'is not', null)
      .where('vendor_kyc.status', 'in', ['PENDING', 'VERIFIED'])
      .orderBy('vendors.legal_name')
      .execute();
  }

  /**
   * Fills in `value_masked` without touching `status`/`verified_by` — this
   * is not a re-submission (which resets verification, `upsertKyc` below),
   * it is recording what was already on the photo. The `value_masked is
   * null` guard makes this a no-op rather than an overwrite if the value
   * was somehow already backfilled by the time this runs (double-submit,
   * two Compliance tabs) — `rowCount === 0` means the caller lost the race
   * or the row is no longer in the gap it thought it was in.
   */
  async backfillKycValue(db: DbExecutor, vendorId: string, kind: string, valueMasked: string): Promise<boolean> {
    const result = await db
      .updateTable('vendor_kyc')
      .set({ value_masked: valueMasked })
      .where('vendor_id', '=', vendorId)
      .where('kind', '=', kind)
      .where('value_masked', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  upsertKyc(
    db: DbExecutor,
    row: { vendorId: string; kind: string; valueMasked: string | null; route: string; attachmentId: string | null },
  ) {
    return db
      .insertInto('vendor_kyc')
      .values({
        vendor_id: row.vendorId,
        kind: row.kind,
        value_masked: row.valueMasked,
        route: row.route,
        attachment_id: row.attachmentId,
        status: 'PENDING',
        verified_by: null,
        verified_at: null,
      })
      .onConflict((oc) =>
        oc.columns(['vendor_id', 'kind']).doUpdateSet({
          value_masked: row.valueMasked,
          route: row.route,
          attachment_id: row.attachmentId,
          // BR-31 / FE.md: a re-upload resets verification, never carries it forward.
          status: 'PENDING',
          verified_by: null,
          verified_at: null,
          // A fresh photo makes the old rejection stale — carrying it forward
          // would tell the transporter their new upload was rejected too.
          reject_reason: null,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  decideKyc(
    db: DbExecutor,
    vendorId: string,
    kind: string,
    status: 'VERIFIED' | 'REJECTED',
    verifiedBy: string,
    rejectReason: string | null,
  ) {
    return db
      .updateTable('vendor_kyc')
      .set({ status, verified_by: verifiedBy, verified_at: new Date().toISOString(), reject_reason: rejectReason })
      .where('vendor_id', '=', vendorId)
      .where('kind', '=', kind)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Documents -------------------------------------------------------

  /**
   * Every time-bound legal document across every vendor, for the periodic
   * audit sweep.
   *
   * One query rather than a `findDocuments` per vendor: the sweep runs over
   * the whole book nightly, and N+1 against a few thousand transporters is the
   * difference between a job that finishes and one that quietly stops being
   * run. Only ACTIVE vendors — a suspended one is already off the board, and
   * listing their lapsed papers in a chase queue is work nobody should do.
   */
  documentsForExpirySweep(kinds: string[]) {
    return this.db
      .selectFrom('vendor_documents')
      .innerJoin('vendors', 'vendors.id', 'vendor_documents.vendor_id')
      .select([
        'vendors.id as vendorId',
        'vendors.code as vendorCode',
        'vendors.legal_name as vendorName',
        'vendors.status as vendorStatus',
        'vendors.phone as vendorPhone',
        'vendors.branch_id as branchId',
        'vendor_documents.kind as kind',
        'vendor_documents.status as status',
        'vendor_documents.valid_to as validTo',
      ])
      .where('vendors.status', '=', 'ACTIVE')
      .where('vendor_documents.kind', 'in', kinds)
      .where('vendor_documents.status', '=', 'VERIFIED')
      // A document with no recorded expiry is not expired — it is unrecorded,
      // and `expiryStateOf` reports it as NO_EXPIRY. Excluded here so the
      // sweep reads only rows that can actually lapse.
      .where('vendor_documents.valid_to', 'is not', null)
      .execute();
  }

  findDocuments(vendorId: string) {
    return this.db.selectFrom('vendor_documents').selectAll().where('vendor_id', '=', vendorId).execute();
  }

  findDocumentOne(db: DbExecutor, vendorId: string, kind: string) {
    return db
      .selectFrom('vendor_documents')
      .selectAll()
      .where('vendor_id', '=', vendorId)
      .where('kind', '=', kind)
      .executeTakeFirst();
  }

  upsertDocument(
    db: DbExecutor,
    row: {
      vendorId: string;
      kind: string;
      attachmentId: string;
      reference: string | null;
      validFrom: string | null;
      validTo: string | null;
    },
  ) {
    return db
      .insertInto('vendor_documents')
      .values({
        vendor_id: row.vendorId,
        kind: row.kind,
        attachment_id: row.attachmentId,
        reference: row.reference,
        valid_from: row.validFrom,
        valid_to: row.validTo,
        status: 'PENDING',
        verified_by: null,
      })
      .onConflict((oc) =>
        oc.columns(['vendor_id', 'kind']).doUpdateSet({
          attachment_id: row.attachmentId,
          reference: row.reference,
          valid_from: row.validFrom,
          valid_to: row.validTo,
          status: 'PENDING',
          verified_by: null,
          // Same reasoning as `upsertKyc`: a fresh upload makes the old
          // rejection reason stale.
          reject_reason: null,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  decideDocument(
    db: DbExecutor,
    vendorId: string,
    kind: string,
    status: 'VERIFIED' | 'REJECTED',
    verifiedBy: string,
    rejectReason: string | null,
  ) {
    return db
      .updateTable('vendor_documents')
      .set({ status, verified_by: verifiedBy, reject_reason: rejectReason })
      .where('vendor_id', '=', vendorId)
      .where('kind', '=', kind)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Fleet / advance history / business stats ------------------------

  findFleet(vendorId: string) {
    return this.db.selectFrom('vendor_fleet').selectAll().where('vendor_id', '=', vendorId).execute();
  }

  findAdvanceHistory(vendorId: string) {
    return this.db
      .selectFrom('vendor_advance_history')
      .innerJoin('users', 'users.id', 'vendor_advance_history.changed_by')
      .select([
        'vendor_advance_history.old_pct as oldPct',
        'vendor_advance_history.new_pct as newPct',
        'users.name as changedByName',
        'vendor_advance_history.changed_at as changedAt',
        'vendor_advance_history.approval_id as approvalId',
      ])
      .where('vendor_id', '=', vendorId)
      .orderBy('vendor_advance_history.changed_at', 'desc')
      .execute();
  }

  insertAdvanceHistory(
    db: DbExecutor,
    row: { vendorId: string; oldPct: number; newPct: number; approvalId: string | null; changedBy: string },
  ) {
    return db
      .insertInto('vendor_advance_history')
      .values({
        vendor_id: row.vendorId,
        old_pct: row.oldPct,
        new_pct: row.newPct,
        approval_id: row.approvalId,
        changed_by: row.changedBy,
      })
      .execute();
  }

  /**
   * Real aggregates against `trips`/`indents`, which already exist even
   * though C3/C4 haven't shipped their own modules yet — there are simply no
   * rows until then, so every number here is honestly zero rather than faked.
   */
  async findBusinessStats(vendorId: string) {
    const totals = await this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .select((eb) => [
        eb.fn.count<number>('trips.id').as('trips'),
        eb.fn.coalesce(eb.fn.sum<number>('indents.sell_rate'), sql<number>`0`).as('revenuePaise'),
        eb.fn
          .coalesce(eb.fn.sum<number>(sql`indents.sell_rate - trips.buy_rate`), sql<number>`0`)
          .as('marginPaise'),
        eb.fn
          .coalesce(eb.fn.sum<number>(sql`trips.buy_rate - trips.advance_paid - trips.balance_paid`), sql<number>`0`)
          .as('outstandingPaise'),
        eb.fn.coalesce(eb.fn.sum<number>('trips.pod_penalty'), sql<number>`0`).as('penaltiesAccruedPaise'),
      ])
      .where('trips.vendor_id', '=', vendorId)
      .executeTakeFirstOrThrow();

    const lanes = await this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .select((eb) => [
        'trips.lane as lane',
        eb.fn.count<number>('trips.id').as('trips'),
        eb.fn.coalesce(eb.fn.sum<number>('indents.sell_rate'), sql<number>`0`).as('revenuePaise'),
        eb.fn
          .coalesce(eb.fn.sum<number>(sql`indents.sell_rate - trips.buy_rate`), sql<number>`0`)
          .as('marginPaise'),
      ])
      .where('trips.vendor_id', '=', vendorId)
      .groupBy('trips.lane')
      .orderBy(eb => eb.fn.count('trips.id'), 'desc')
      .limit(5)
      .execute();

    return { totals, lanes };
  }
}
