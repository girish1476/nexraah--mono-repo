import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

export interface InvoiceListFilters {
  q?: string;
  status?: string;
  from?: string;
  to?: string;
}

@Injectable()
export class InvoicingRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  private baseInvoiceQuery() {
    return this.db
      .selectFrom('invoices')
      .innerJoin('clients', 'clients.id', 'invoices.client_id')
      .select([
        'invoices.id as id',
        'invoices.code as code',
        'invoices.client_id as clientId',
        'clients.name as clientName',
        'invoices.invoice_date as invoiceDate',
        'invoices.due_date as dueDate',
        'invoices.freight as freightPaise',
        'invoices.loading as loadingPaise',
        'invoices.unloading as unloadingPaise',
        'invoices.detention as detentionPaise',
        'invoices.other as otherPaise',
        'invoices.discount as discountPaise',
        'invoices.round_off as roundOffPaise',
        'invoices.total as totalPaise',
        'invoices.received as receivedPaise',
        'invoices.tax_mechanism as taxMechanism',
        'invoices.status as status',
        'invoices.cancel_reason as cancelReason',
        'invoices.notes as notes',
      ]);
  }

  // ---- Invoices ---------------------------------------------------------

  list(filters: InvoiceListFilters) {
    let query = this.baseInvoiceQuery();
    if (filters.q) {
      const term = `%${filters.q}%`;
      query = query.where((eb) => eb.or([eb('invoices.code', 'ilike', term), eb('clients.name', 'ilike', term)]));
    }
    if (filters.status) query = query.where('invoices.status', '=', filters.status);
    if (filters.from) query = query.where('invoices.invoice_date', '>=', filters.from);
    if (filters.to) query = query.where('invoices.invoice_date', '<=', filters.to);
    return query.orderBy('invoices.created_at', 'desc').execute();
  }

  findById(id: string) {
    return this.baseInvoiceQuery().where('invoices.id', '=', id).executeTakeFirst();
  }

  findByIdForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('invoices').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  insertInvoiceDraft(
    db: DbExecutor,
    row: {
      id: string;
      code: string;
      client_id: string;
      invoice_date: string;
      due_date: string;
      freight: number;
      loading: number;
      unloading: number;
      detention: number;
      other: number;
      discount: number;
      round_off: number;
      total: number;
      notes: string | null;
    },
  ) {
    return db
      .insertInto('invoices')
      .values({ ...row, status: 'DRAFT', received: 0 })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  updateInvoice(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('invoices').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }

  // ---- Clients ------------------------------------------------------------

  findClientById(id: string) {
    return this.db.selectFrom('clients').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Mirrors `ClientsRepository.outstandingPaise` — each module owns its own reads, not a cross-import. */
  async clientOutstandingPaise(clientId: string): Promise<number> {
    const row = await this.db
      .selectFrom('invoices')
      .select((eb) => [
        eb.fn.coalesce(eb.fn.sum<number>('invoices.total'), sql<number>`0`).as('total'),
        eb.fn.coalesce(eb.fn.sum<number>('invoices.received'), sql<number>`0`).as('received'),
      ])
      .where('client_id', '=', clientId)
      .where('status', '!=', 'CANCELLED')
      .executeTakeFirstOrThrow();
    return Math.max(0, Number(row.total) - Number(row.received));
  }

  // ---- Trips linked to an invoice -----------------------------------------

  findTripsByIdsForUpdate(db: DbExecutor, tripIds: string[]) {
    if (tripIds.length === 0) return Promise.resolve([]);
    return db.selectFrom('trips').selectAll().where('id', 'in', tripIds).forUpdate().execute();
  }

  insertInvoiceTrips(db: DbExecutor, invoiceId: string, tripIds: string[]) {
    if (tripIds.length === 0) return Promise.resolve(undefined);
    return db
      .insertInto('invoice_trips')
      .values(tripIds.map((tripId) => ({ invoice_id: invoiceId, trip_id: tripId })))
      .execute();
  }

  invoiceTripIds(invoiceId: string) {
    return this.db.selectFrom('invoice_trips').select('trip_id').where('invoice_id', '=', invoiceId).execute();
  }

  /** Batched for `list()` — one query for every listed invoice's trip links, not N+1. */
  invoiceTripsForInvoices(invoiceIds: string[]) {
    if (invoiceIds.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom('invoice_trips')
      .select(['invoice_id', 'trip_id'])
      .where('invoice_id', 'in', invoiceIds)
      .execute();
  }

  /** Same join shape as `TripsRepository`'s list query, kept local per this codebase's module boundaries. */
  findTripsForInvoice(invoiceId: string) {
    return this.db
      .selectFrom('invoice_trips')
      .innerJoin('trips', 'trips.id', 'invoice_trips.trip_id')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .innerJoin('clients', 'clients.id', 'trips.client_id')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .leftJoin('lorry_receipts', 'lorry_receipts.trip_id', 'trips.id')
      .where('invoice_trips.invoice_id', '=', invoiceId)
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
        'trips.pod_penalty as podPenaltyPaise',
      ])
      .execute();
  }

  markTripsBilled(db: DbExecutor, tripIds: string[]) {
    if (tripIds.length === 0) return Promise.resolve(undefined);
    return db.updateTable('trips').set({ billed: true }).where('id', 'in', tripIds).execute();
  }

  // ---- Receipts -----------------------------------------------------------

  findReceiptsForInvoice(invoiceId: string) {
    return this.db
      .selectFrom('receipts')
      .selectAll()
      .where('invoice_id', '=', invoiceId)
      .orderBy('created_at', 'desc')
      .execute();
  }

  findReceiptByIdempotencyKeyForUpdate(db: DbExecutor, key: string) {
    return db.selectFrom('receipts').selectAll().where('idempotency_key', '=', key).forUpdate().executeTakeFirst();
  }

  insertReceipt(
    db: DbExecutor,
    row: {
      id: string;
      code: string;
      invoice_id: string;
      client_id: string;
      amount: number;
      received_on: string;
      mode: string;
      reference: string;
      remarks: string | null;
      idempotency_key: string;
    },
  ) {
    return db.insertInto('receipts').values(row).returningAll().executeTakeFirstOrThrow();
  }

  private baseReceiptQuery() {
    return this.db
      .selectFrom('receipts')
      .innerJoin('invoices', 'invoices.id', 'receipts.invoice_id')
      .innerJoin('clients', 'clients.id', 'receipts.client_id')
      .select([
        'receipts.id as id',
        'receipts.code as code',
        'receipts.invoice_id as invoiceId',
        'invoices.code as invoiceCode',
        'receipts.client_id as clientId',
        'clients.name as clientName',
        'receipts.amount as amountPaise',
        'receipts.received_on as receivedOn',
        'receipts.mode as mode',
        'receipts.reference as reference',
        'receipts.remarks as remarks',
      ]);
  }

  // ---- Receivables ----------------------------------------------------------

  receivablesRows(clientId?: string) {
    let query = this.baseInvoiceQuery().where('invoices.status', 'in', ['ISSUED', 'PART_PAID']);
    if (clientId) query = query.where('invoices.client_id', '=', clientId);
    return query.execute();
  }

  recentReceipts(clientId?: string) {
    let query = this.baseReceiptQuery().orderBy('receipts.created_at', 'desc');
    if (clientId) query = query.where('receipts.client_id', '=', clientId);
    return query.execute();
  }
}
