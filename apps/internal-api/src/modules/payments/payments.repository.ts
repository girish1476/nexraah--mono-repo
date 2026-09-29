import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  // ---- Advance queue / resolution --------------------------------------

  advanceQueue(status?: string) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .select([
        'indents.id as indentId',
        'indents.code as indentCode',
        'trips.id as tripId',
        'trips.code as tripCode',
        'vendors.legal_name as vendorName',
        'trips.lane as lane',
        'branches.name as branchName',
        'indents.advance_pct as advancePct',
        'trips.buy_rate as buyRate',
        'trips.advance_paid as advancePaid',
      ]);
    // With no status, "the advance queue" means trips genuinely awaiting a
    // decision — the same `advance_paid = 0` condition as the explicit
    // 'pending' branch — not every trip ever created. Compare balanceQueue()
    // above, which always filters `trips.stage = 'DELIVERED'` unconditionally.
    if (status === 'released') query = query.where('trips.advance_paid', '>', 0);
    else if (status === 'pending' || !status) query = query.where('trips.advance_paid', '=', 0);
    return query.execute();
  }

  resolveByTripId(id: string) {
    return this.db.selectFrom('trips').selectAll().where('id', '=', id).executeTakeFirst();
  }

  resolveIndentById(id: string) {
    return this.db.selectFrom('indents').selectAll().where('id', '=', id).executeTakeFirst();
  }

  resolveIndentByCode(code: string) {
    return this.db.selectFrom('indents').selectAll().where('code', '=', code).executeTakeFirst();
  }

  findVendorById(id: string) {
    return this.db.selectFrom('vendors').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  findTripByIndentId(indentId: string) {
    return this.db.selectFrom('trips').selectAll().where('indent_id', '=', indentId).executeTakeFirst();
  }

  findTripForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('trips').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  updateTrip(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('trips').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }

  findDocuments(tripId: string) {
    return this.db
      .selectFrom('trip_documents')
      .select(['kind', 'status'])
      .where('trip_id', '=', tripId)
      .execute();
  }

  chargeCostTotal(tripId: string) {
    return this.db
      .selectFrom('trip_charges')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('cost_amount'), sql<number>`0`).as('total'))
      .where('trip_id', '=', tripId)
      .executeTakeFirstOrThrow();
  }

  // ---- Balance queue ----------------------------------------------------

  balanceQueue() {
    return this.db
      .selectFrom('trips')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .select([
        'trips.id as tripId',
        'trips.code as tripCode',
        'vendors.legal_name as vendorName',
        'trips.lane as lane',
        'branches.name as branchName',
        'trips.pod_status as podStatus',
        'trips.pod_received_at as podReceivedAt',
        'trips.pod_closure_basis as podClosureBasis',
        'trips.pod_penalty as podPenalty',
        'trips.buy_rate as buyRate',
        'trips.advance_paid as advancePaid',
        'trips.balance_paid as balancePaid',
      ])
      .where('trips.stage', '=', 'DELIVERED')
      .execute();
  }

  // ---- Payments -----------------------------------------------------

  findByIdempotencyKey(key: string) {
    return this.db.selectFrom('payments').selectAll().where('idempotency_key', '=', key).executeTakeFirst();
  }

  findByIdempotencyKeyForUpdate(db: DbExecutor, key: string) {
    return db.selectFrom('payments').selectAll().where('idempotency_key', '=', key).forUpdate().executeTakeFirst();
  }

  insertPayment(
    db: DbExecutor,
    row: {
      tripId: string | null;
      indentId: string | null;
      kind: 'ADVANCE' | 'BALANCE';
      gross: number;
      penalty: number;
      mode: string;
      transferType: string;
      remittingAccount: string;
      utr: string;
      valueDate: string;
      releasedBy: string;
      idempotencyKey: string;
    },
  ) {
    return db
      .insertInto('payments')
      .values({
        trip_id: row.tripId,
        indent_id: row.indentId,
        kind: row.kind,
        gross: row.gross,
        penalty: row.penalty,
        mode: row.mode,
        transfer_type: row.transferType,
        remitting_account: row.remittingAccount,
        utr: row.utr,
        value_date: row.valueDate,
        released_by: row.releasedBy,
        idempotency_key: row.idempotencyKey,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Transporter bills --------------------------------------------

  /**
   * The bill shape `docs/api/06-payments.md` documents, built in one place so
   * the list and the detail route cannot drift apart. A second hand-copied
   * select is exactly how two endpoints end up disagreeing about the same row.
   */
  private billQuery() {
    return this.db
      .selectFrom('vendor_bills')
      .innerJoin('trips', 'trips.id', 'vendor_bills.trip_id')
      .innerJoin('vendors', 'vendors.id', 'vendor_bills.vendor_id')
      .select([
        'vendor_bills.id as id',
        'vendor_bills.trip_id as tripId',
        'trips.code as tripCode',
        'vendor_bills.vendor_id as vendorId',
        'vendors.legal_name as vendorName',
        'vendor_bills.bill_no as billNo',
        'vendor_bills.bill_date as billDate',
        'vendor_bills.attachment_id as attachmentId',
        'vendor_bills.freight as freightPaise',
        'vendor_bills.charges as chargesPaise',
        'vendor_bills.total as totalPaise',
        'vendor_bills.submitted_at as submittedAt',
        'vendor_bills.computed_balance as computedBalancePaise',
        'vendor_bills.variance as variancePaise',
        'trips.pod_status as podStatus',
        'vendor_bills.status as status',
      ]);
  }

  listBills(status?: string) {
    let query = this.billQuery();
    if (status) query = query.where('vendor_bills.status', 'in', status.split(','));
    return query.orderBy('vendor_bills.submitted_at', 'desc').execute();
  }

  /** One bill, same shape as the list. `docs/api/06-payments.md` §Transporter bills. */
  findBillById(id: string) {
    return this.billQuery().where('vendor_bills.id', '=', id).executeTakeFirst();
  }

  findBillForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('vendor_bills').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  updateBill(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('vendor_bills').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
}
