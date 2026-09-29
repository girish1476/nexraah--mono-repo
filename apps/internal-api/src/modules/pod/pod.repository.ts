import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

@Injectable()
export class PodRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  findTripById(id: string) {
    return this.db.selectFrom('trips').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /**
   * Trip + the display joins the POD detail page needs (vendor, client,
   * lane, LR and indent code) — `findTripById` stays a bare `selectAll` for
   * callers (e.g. `waive`) that only need trip columns; this mirrors the
   * join pattern `receiving()`/`pending()` already use.
   */
  findTripDetailById(id: string) {
    return this.db
      .selectFrom('trips')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .innerJoin('clients', 'clients.id', 'trips.client_id')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .leftJoin('lorry_receipts', 'lorry_receipts.trip_id', 'trips.id')
      .select([
        'trips.id as id',
        'trips.code as code',
        'trips.delivered_at as deliveredAt',
        'trips.pod_status as podStatus',
        'trips.pod_received_at as podReceivedAt',
        'trips.pod_closure_basis as podClosureBasis',
        'trips.pod_penalty as podPenalty',
        'lorry_receipts.code as lrCode',
        'vendors.legal_name as vendorName',
        'clients.name as clientName',
        'trips.lane as lane',
        'indents.code as indentCode',
      ])
      .where('trips.id', '=', id)
      .executeTakeFirst();
  }

  findTripForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('trips').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  updateTrip(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('trips').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }

  /**
   * Lean candidate set for the nightly `pod-ageing` sweep — just the columns
   * `effectivePenalty` needs, no display joins. `pod_status` never holds
   * `'WAIVED'` (only `pod_closure_basis` does — the desk waives the penalty,
   * not the delivery status), so that half of the filter is a separate
   * `where` on `pod_closure_basis`, not part of the `pod_status` list.
   */
  dueForPenaltySweep() {
    return this.db
      .selectFrom('trips')
      .select(['id', 'delivered_at', 'pod_received_at', 'pod_closure_basis', 'pod_penalty'])
      .where('delivered_at', 'is not', null) // effectivePenalty is a no-op before delivery — no point sweeping it
      .where('pod_status', 'not in', ['APPROVED', 'FORFEITED'])
      .where((eb) => eb.or([eb('pod_closure_basis', 'is', null), eb('pod_closure_basis', '!=', 'WAIVED')]))
      .execute();
  }

  /** The receiving register — trips delivered but not yet RECEIVED/beyond. */
  receiving(branchId?: string) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .leftJoin('lorry_receipts', 'lorry_receipts.trip_id', 'trips.id')
      .leftJoin('pod_receipts', (join) =>
        join.onRef('pod_receipts.trip_id', '=', 'trips.id').on('pod_receipts.received_on', 'is not', null),
      )
      .select([
        'trips.id as tripId',
        'trips.code as tripCode',
        'lorry_receipts.code as lrCode',
        'vendors.legal_name as vendorName',
        'trips.lane as lane',
        'trips.delivered_at as deliveredAt',
        'pod_receipts.courier_docket as courierDocket',
        'trips.pod_status as podStatus',
        'trips.advance_paid as advancePaidPaise',
        'trips.buy_rate as buyRatePaise',
      ])
      .where('trips.pod_status', 'in', ['PENDING', 'ATTACHED']);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.execute();
  }

  /** The chase list — everything not yet APPROVED/WAIVED/FORFEITED. */
  pending(filters: { branchId?: string; vendorId?: string }) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .innerJoin('clients', 'clients.id', 'trips.client_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .leftJoin('lorry_receipts', 'lorry_receipts.trip_id', 'trips.id')
      .select([
        'trips.id as tripId',
        'trips.code as tripCode',
        'lorry_receipts.code as lrCode',
        'vendors.legal_name as vendorName',
        'clients.name as clientName',
        'trips.lane as lane',
        'branches.name as branchName',
        'trips.delivered_at as deliveredAt',
        'trips.pod_received_at as podReceivedAt',
        'trips.pod_status as podStatus',
        'trips.pod_closure_basis as podClosureBasis',
        'trips.buy_rate as buyRatePaise',
        'trips.advance_paid as advancePaidPaise',
      ])
      .where('trips.pod_status', 'not in', ['APPROVED', 'FORFEITED']);
    if (filters.branchId) query = query.where('trips.branch_id', '=', filters.branchId);
    if (filters.vendorId) query = query.where('trips.vendor_id', '=', filters.vendorId);
    return query.orderBy('trips.delivered_at').execute();
  }

  findReceipt(tripId: string) {
    return this.db.selectFrom('pod_receipts').selectAll().where('trip_id', '=', tripId).executeTakeFirst();
  }

  findReceiptForUpdate(db: DbExecutor, tripId: string) {
    return db.selectFrom('pod_receipts').selectAll().where('trip_id', '=', tripId).forUpdate().executeTakeFirst();
  }

  /** POD_RECEIPT is per-branch (part 01 §4.1); nothing provisions it yet, so ensure it exists on first use. */
  async ensureSeriesForBranch(db: DbExecutor, branchId: string) {
    await db
      .insertInto('number_series')
      .values({ key: 'POD_RECEIPT', prefix: 'PDR-', width: 4, scope: 'BRANCH', branch_id: branchId })
      .onConflict((oc) => oc.columns(['key', 'branch_id']).doNothing())
      .execute();
  }

  insertReceipt(
    db: DbExecutor,
    row: {
      code: string;
      tripId: string;
      courierDocket: string;
      sentOn: string;
      receivedOn: string;
      pages: number | null;
      receivedBy: string;
      condition: string | null;
    },
  ) {
    return db
      .insertInto('pod_receipts')
      .values({
        code: row.code,
        trip_id: row.tripId,
        courier_docket: row.courierDocket,
        sent_on: row.sentOn,
        received_on: row.receivedOn,
        pages: row.pages,
        received_by: row.receivedBy,
        condition: row.condition,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  decideReceipt(db: DbExecutor, tripId: string, patch: Record<string, unknown>) {
    return db
      .updateTable('pod_receipts')
      .set(patch)
      .where('trip_id', '=', tripId)
      .returningAll()
      .executeTakeFirstOrThrow();
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
      .execute();
  }

  findCharges(tripId: string) {
    return this.db
      .selectFrom('trip_charges')
      .select(['id', 'charge_type as chargeType', 'cost_amount as costAmountPaise', 'billed_amount as billedAmountPaise'])
      .where('trip_id', '=', tripId)
      .execute();
  }

  /**
   * Receipts actually logged today, by `received_on` (BR-49, the date that
   * stops the clock) — not `deliveredAt`. Deliberately independent of
   * `receiving()`: that query is filtered to `pod_status in ('PENDING',
   * 'ATTACHED')`, so a row it returns can never be `RECEIVED` and can't be
   * used to count today's receipts.
   */
  async receivedTodayCount(branchId?: string) {
    let query = this.db
      .selectFrom('pod_receipts')
      .innerJoin('trips', 'trips.id', 'pod_receipts.trip_id')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('pod_receipts.received_on', '=', sql<string>`current_date`);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    const row = await query.executeTakeFirstOrThrow();
    return Number(row.count);
  }

  /** Aggregate stats for the receiving register / chase list headers. */
  async receivingStats(branchId?: string) {
    let query = this.db
      .selectFrom('trips')
      .select((eb) => [
        eb.fn.count<number>('id').filterWhere('pod_status', '=', 'ATTACHED').as('attachedInTransit'),
        eb.fn.count<number>('id').filterWhere('pod_status', '=', 'VERIFIED').as('awaitingApproval'),
        eb.fn.coalesce(eb.fn.sum<number>(sql`buy_rate - advance_paid`), sql<number>`0`).as('balanceHeldPaise'),
      ]);
    if (branchId) query = query.where('branch_id', '=', branchId);
    return query.executeTakeFirstOrThrow();
  }
}
