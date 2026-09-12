import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

export interface TripListFilters {
  q?: string;
  field?: string;
  stage?: string;
  branchId?: string;
  vendorId?: string;
  podStatus?: string;
}

@Injectable()
export class TripsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  private baseListQuery() {
    return this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .innerJoin('clients', 'clients.id', 'trips.client_id')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .leftJoin('lorry_receipts', 'lorry_receipts.trip_id', 'trips.id')
      .select([
        'trips.id as id',
        'trips.code as code',
        'lorry_receipts.code as lrCode',
        'indents.code as indentCode',
        'clients.name as clientName',
        'vendors.legal_name as vendorName',
        'branches.name as branchName',
        'trips.lane as lane',
        'trips.vehicle_no as vehicleNo',
        'trips.stage as stage',
        'trips.pod_status as podStatus',
        'trips.delivered_at as deliveredAt',
        'trips.buy_rate as buyRatePaise',
        'indents.sell_rate as sellRatePaise',
        'trips.advance_paid as advancePaidPaise',
        'trips.balance_paid as balancePaidPaise',
        'trips.pod_penalty as podPenaltyPaise',
      ]);
  }

  list(filters: TripListFilters) {
    let query = this.baseListQuery();

    if (filters.q) {
      const term = `%${filters.q}%`;
      const fieldMap: Record<string, string> = {
        lr: 'lorry_receipts.code',
        trip: 'trips.code',
        indent: 'indents.code',
        truck: 'trips.vehicle_no',
        transporter: 'vendors.legal_name',
        company: 'clients.name',
        branch: 'branches.name',
      };
      const column = filters.field ? fieldMap[filters.field] : undefined;
      if (column) {
        query = query.where(column as 'trips.code', 'ilike', term);
      } else {
        query = query.where((eb) =>
          eb.or([
            eb('trips.code', 'ilike', term),
            eb('lorry_receipts.code', 'ilike', term),
            eb('indents.code', 'ilike', term),
            eb('trips.vehicle_no', 'ilike', term),
            eb('vendors.legal_name', 'ilike', term),
            eb('clients.name', 'ilike', term),
            eb('branches.name', 'ilike', term),
          ]),
        );
      }
    }
    if (filters.stage) query = query.where('trips.stage', 'in', filters.stage.split(','));
    if (filters.branchId) query = query.where('trips.branch_id', '=', filters.branchId);
    if (filters.vendorId) query = query.where('trips.vendor_id', '=', filters.vendorId);
    if (filters.podStatus) query = query.where('trips.pod_status', 'in', filters.podStatus.split(','));

    return query.orderBy('trips.created_at', 'desc').execute();
  }

  /**
   * Joins the names/codes the detail screen renders unconditionally
   * (part 05 §2) — `list()`/`baseListQuery()` already join these for the
   * list row shape; `findById()` returned only `trips.*`, leaving
   * `clientName`, `vendorName`, `branchName`, `indentCode`, `lrCode` and
   * `podPenaltyPaise` undefined on the trip detail page. Mirrors
   * `baseListQuery()`'s join shape; `selectAll('trips')` keeps every trips
   * column in its own snake_case shape so existing callers (`trip.indent_id`,
   * `trip.buy_rate`, etc.) are untouched, same pattern as
   * `indents.repository.ts`'s `findById()`.
   */
  findById(id: string) {
    return this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .innerJoin('clients', 'clients.id', 'trips.client_id')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .leftJoin('lorry_receipts', 'lorry_receipts.trip_id', 'trips.id')
      .selectAll('trips')
      .select([
        'indents.code as indentCode',
        'clients.name as clientName',
        'vendors.legal_name as vendorName',
        'branches.name as branchName',
        'lorry_receipts.code as lrCode',
        'trips.pod_penalty as podPenaltyPaise',
      ])
      .where('trips.id', '=', id)
      .executeTakeFirst();
  }

  findByIdForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('trips').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  findIndentForTrip(indentId: string) {
    return this.db.selectFrom('indents').selectAll().where('id', '=', indentId).executeTakeFirst();
  }

  // ---- Documents --------------------------------------------------------

  findDocuments(tripId: string) {
    return this.db.selectFrom('trip_documents').selectAll().where('trip_id', '=', tripId).execute();
  }

  findDocumentOne(db: DbExecutor, tripId: string, kind: string) {
    return db
      .selectFrom('trip_documents')
      .selectAll()
      .where('trip_id', '=', tripId)
      .where('kind', '=', kind)
      .executeTakeFirst();
  }

  upsertDocument(
    db: DbExecutor,
    row: { tripId: string; kind: string; attachmentId: string | null; keyedValues: unknown },
  ) {
    return db
      .insertInto('trip_documents')
      .values({
        trip_id: row.tripId,
        kind: row.kind,
        attachment_id: row.attachmentId,
        keyed_values: row.keyedValues === undefined ? null : (row.keyedValues as never),
        status: 'PENDING',
        verified_by: null,
        verified_at: null,
        reject_reason: null,
      })
      .onConflict((oc) =>
        oc.columns(['trip_id', 'kind']).doUpdateSet({
          attachment_id: row.attachmentId,
          keyed_values: row.keyedValues === undefined ? null : (row.keyedValues as never),
          status: 'PENDING',
          verified_by: null,
          verified_at: null,
          reject_reason: null,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  decideDocument(
    db: DbExecutor,
    tripId: string,
    kind: string,
    status: 'VERIFIED' | 'REJECTED',
    verifiedBy: string,
    rejectReason: string | null,
  ) {
    return db
      .updateTable('trip_documents')
      .set({ status, verified_by: verifiedBy, verified_at: new Date().toISOString(), reject_reason: rejectReason })
      .where('trip_id', '=', tripId)
      .where('kind', '=', kind)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Charges ------------------------------------------------------

  findCharges(tripId: string) {
    return this.db
      .selectFrom('trip_charges')
      .innerJoin('users', 'users.id', 'trip_charges.captured_by')
      .select([
        'trip_charges.id as id',
        'trip_charges.charge_type as chargeType',
        'trip_charges.cost_amount as costAmountPaise',
        'trip_charges.billed_amount as billedAmountPaise',
        'users.name as capturedBy',
        'trip_charges.captured_at as capturedAt',
      ])
      .where('trip_id', '=', tripId)
      .execute();
  }

  insertCharge(
    db: DbExecutor,
    row: { tripId: string; chargeType: string; costAmountPaise: number; billedAmountPaise: number; capturedBy: string },
  ) {
    return db
      .insertInto('trip_charges')
      .values({
        trip_id: row.tripId,
        charge_type: row.chargeType,
        cost_amount: row.costAmountPaise,
        billed_amount: row.billedAmountPaise,
        captured_by: row.capturedBy,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Lorry receipt --------------------------------------------------

  findLr(tripId: string) {
    return this.db.selectFrom('lorry_receipts').selectAll().where('trip_id', '=', tripId).executeTakeFirst();
  }

  findLrForUpdate(db: DbExecutor, tripId: string) {
    return db.selectFrom('lorry_receipts').selectAll().where('trip_id', '=', tripId).forUpdate().executeTakeFirst();
  }

  /**
   * `patch` is only the fields this call is actually changing — writing
   * defaults-plus-patch on an existing row would reset every previously-saved
   * field to blank on each 3-second autosave.
   *
   * **Update-first, insert-only-if-missing, deliberately not INSERT … ON
   * CONFLICT.** Postgres evaluates NOT NULL and CHECK constraints against the
   * *proposed* tuple before it arbitrates the conflict, so an upsert has to
   * offer a tuple that is valid on its own even when the update branch is the
   * one that will win. This table makes that impossible to do honestly:
   * `vehicle` and `driver` are NOT NULL, and `lr_consignor_named` /
   * `lr_consignee_named` require a `name` key. A second autosave carrying only
   * `{remarks}` therefore died on the insert tuple it was never going to use —
   * every save after the first raised, on a form that saves every 3 seconds.
   *
   * The defaults below are only ever reached on a genuine first save, and are
   * shaped to satisfy those CHECKs rather than to look empty.
   */
  async upsertLrDraft(
    db: DbExecutor,
    tripId: string,
    branchId: string,
    patch: Record<string, unknown>,
  ) {
    const updated = await db
      .updateTable('lorry_receipts')
      .set(patch as never)
      .where('trip_id', '=', tripId)
      .returningAll()
      .executeTakeFirst();
    if (updated) return updated;

    const insertValues = {
      trip_id: tripId,
      branch_id: branchId,
      lr_date: new Date().toISOString().slice(0, 10),
      code: `DRAFT-${tripId}`, // replaced by the real LR- code at generate()
      consignor: JSON.stringify({ name: '' }),
      consignee: JSON.stringify({ name: '' }),
      goods: '{}',
      vehicle: '{}',
      driver: '{}',
      status: 'BOOKED',
      ...patch,
    };
    return db
      .insertInto('lorry_receipts')
      .values(insertValues as never)
      // Backstop for two first-saves racing: the loser updates instead of
      // raising a unique violation. Safe here because this tuple is complete.
      .onConflict((oc) => oc.column('trip_id').doUpdateSet(patch as never))
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  finalizeLr(db: DbExecutor, tripId: string, code: string) {
    return db
      .updateTable('lorry_receipts')
      .set({ code, status: 'RELEASED', booked_at: new Date().toISOString() })
      .where('trip_id', '=', tripId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  updateLrStatus(db: DbExecutor, tripId: string, status: string) {
    return db.updateTable('lorry_receipts').set({ status }).where('trip_id', '=', tripId).executeTakeFirst();
  }

  shareLr(tripId: string) {
    return this.db
      .updateTable('lorry_receipts')
      .set({ shared_at: new Date().toISOString() })
      .where('trip_id', '=', tripId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  update(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('trips').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
}
