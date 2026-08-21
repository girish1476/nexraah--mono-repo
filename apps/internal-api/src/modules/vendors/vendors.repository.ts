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
      .leftJoin('vendor_fleet', 'vendor_fleet.vendor_id', 'vendors.id')
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
        eb.fn.count<number>('vendor_fleet.id').distinct().as('fleetCount'),
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

  findById(id: string) {
    return this.db.selectFrom('vendors').selectAll().where('id', '=', id).executeTakeFirst();
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

  findKyc(vendorId: string) {
    return this.db.selectFrom('vendor_kyc').selectAll().where('vendor_id', '=', vendorId).execute();
  }

  findKycOne(db: DbExecutor, vendorId: string, kind: string) {
    return db
      .selectFrom('vendor_kyc')
      .selectAll()
      .where('vendor_id', '=', vendorId)
      .where('kind', '=', kind)
      .executeTakeFirst();
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
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  decideKyc(db: DbExecutor, vendorId: string, kind: string, status: 'VERIFIED' | 'REJECTED', verifiedBy: string) {
    return db
      .updateTable('vendor_kyc')
      .set({ status, verified_by: verifiedBy, verified_at: new Date().toISOString() })
      .where('vendor_id', '=', vendorId)
      .where('kind', '=', kind)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Documents -------------------------------------------------------

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
  ) {
    return db
      .updateTable('vendor_documents')
      .set({ status, verified_by: verifiedBy })
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
