import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { OrderStatus } from '../../db/types';
import { advanceDocsIn, type PodStatus } from './order-ladder';

export interface OrderListFilters {
  /** One of the ten steps, or FAILED. Omitted means every step. */
  status?: string;
  branchId?: string;
  clientId?: string;
  /** `true` = not yet at BALANCE_RELEASED. */
  openOnly?: boolean;
  /** Free text over order number, indent code, client name and lane. */
  q?: string;
  limit: number;
  offset: number;
}

/**
 * Everything an order row needs, in one query.
 *
 * The browser used to assemble this by fetching `/indents`, `/trips` and
 * `/invoices` in full and joining them in JavaScript — three whole tables to
 * render one page of rows, with no way to filter by step server-side. The
 * joins below are the same joins, done where the data is.
 */
@Injectable()
export class OrdersRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  private baseQuery() {
    return this.db
      .selectFrom('orders')
      .innerJoin('indents', 'indents.id', 'orders.indent_id')
      .innerJoin('clients', 'clients.id', 'orders.client_id')
      .innerJoin('branches', 'branches.id', 'orders.branch_id')
      .leftJoin('trips', 'trips.id', 'orders.trip_id')
      .leftJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .leftJoin('invoices', 'invoices.id', 'orders.invoice_id')
      .select([
        'orders.id as id',
        'orders.order_no as orderNo',
        'orders.status as status',
        'orders.step_no as stepNo',
        'orders.closed_at as closedAt',
        'orders.created_at as createdAt',
        'indents.id as indentId',
        'indents.code as indentCode',
        'indents.from_city as fromCity',
        'indents.to_city as toCity',
        'indents.pickup_date as pickupDate',
        'indents.sell_rate as sellRatePaise',
        'indents.failure_cause as failureCause',
        'indents.material as material',
        'indents.weight_kg as weightKg',
        'indents.truck_type as truckType',
        'clients.name as clientName',
        'branches.name as branchName',
        'trips.id as tripId',
        'trips.code as tripCode',
        'trips.vehicle_no as vehicleNo',
        'trips.driver_name as driverName',
        'trips.buy_rate as buyRatePaise',
        'trips.advance_paid as advancePaidPaise',
        'trips.balance_paid as balancePaidPaise',
        'vendors.legal_name as vendorName',
        'invoices.id as invoiceId',
        'invoices.code as invoiceCode',
      ]);
  }

  /**
   * A page of orders, plus the total the page was taken from.
   *
   * The count runs as its own query rather than a window function: the filter
   * set is small and indexed, and a separate count keeps the row query free of
   * a column every caller would have to strip.
   */
  async list(filters: OrderListFilters) {
    const applyFilters = <T extends { where: any }>(query: T): T => {
      let q: any = query;
      if (filters.status) q = q.where('orders.status', '=', filters.status);
      if (filters.branchId) q = q.where('orders.branch_id', '=', filters.branchId);
      if (filters.clientId) q = q.where('orders.client_id', '=', filters.clientId);
      if (filters.openOnly) q = q.where('orders.closed_at', 'is', null);
      if (filters.q) {
        const term = `%${filters.q.toLowerCase()}%`;
        q = q.where((eb: any) =>
          eb.or([
            eb(eb.fn('lower', ['orders.order_no']), 'like', term),
            eb(eb.fn('lower', ['indents.code']), 'like', term),
            eb(eb.fn('lower', ['clients.name']), 'like', term),
            eb(eb.fn('lower', ['indents.from_city']), 'like', term),
            eb(eb.fn('lower', ['indents.to_city']), 'like', term),
          ]),
        );
      }
      return q as T;
    };

    const rows = await applyFilters(this.baseQuery())
      .orderBy('orders.created_at', 'desc')
      .limit(filters.limit)
      .offset(filters.offset)
      .execute();

    const counted = await applyFilters(
      this.db
        .selectFrom('orders')
        .innerJoin('indents', 'indents.id', 'orders.indent_id')
        .innerJoin('clients', 'clients.id', 'orders.client_id')
        .select((eb) => eb.fn.countAll<string>().as('total')),
    ).executeTakeFirst();

    return { rows, total: Number(counted?.total ?? 0) };
  }

  getById(id: string) {
    return this.baseQuery().where('orders.id', '=', id).executeTakeFirst();
  }

  getByIndentId(indentId: string) {
    return this.baseQuery().where('orders.indent_id', '=', indentId).executeTakeFirst();
  }

  getByIndentCode(indentCode: string) {
    return this.baseQuery().where('indents.code', '=', indentCode).executeTakeFirst();
  }

  /** Counts per step, for the phase tabs — one query, not one per tab. */
  async countsByStatus(branchId?: string) {
    let q = this.db
      .selectFrom('orders')
      .select((eb) => ['orders.status as status', eb.fn.countAll<string>().as('count')])
      .groupBy('orders.status');
    if (branchId) q = q.where('orders.branch_id', '=', branchId);
    const rows = await q.execute();
    return rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.status] = Number(r.count);
      return acc;
    }, {});
  }

  events(orderId: string) {
    return this.db
      .selectFrom('order_events')
      .leftJoin('users', 'users.id', 'order_events.actor_user_id')
      .select([
        'order_events.id as id',
        'order_events.status as status',
        'order_events.step_no as stepNo',
        'order_events.note as note',
        'order_events.at as at',
        'users.name as actorName',
      ])
      .where('order_events.order_id', '=', orderId)
      .orderBy('order_events.at', 'asc')
      .execute();
  }

  /**
   * The facts the ladder is computed from, for one indent.
   *
   * Deliberately returns raw state rather than a status: deciding *which step*
   * these facts add up to is `OrdersService.recompute()`'s single job, and
   * splitting that decision across two files is how the old browser-side
   * version ended up with two disagreeing copies.
   */
  async ladderInputs(indentId: string, advanceDocKinds: string[]) {
    const indent = await this.db
      .selectFrom('indents')
      .select(['id', 'stage', 'failure_cause as failureCause', 'client_id as clientId', 'branch_id as branchId'])
      .where('id', '=', indentId)
      .executeTakeFirst();
    if (!indent) return null;

    const trip = await this.db
      .selectFrom('trips')
      .leftJoin('lorry_receipts', 'lorry_receipts.trip_id', 'trips.id')
      .select([
        'trips.id as id',
        'trips.stage as stage',
        'trips.pod_status as podStatus',
        'trips.advance_paid as advancePaidPaise',
        'trips.balance_paid as balancePaidPaise',
        'lorry_receipts.code as lrCode',
      ])
      .where('trips.indent_id', '=', indentId)
      .executeTakeFirst();

    /*
     * "Uploaded" means present, not yet verified — verification is the advance
     * gate's own checklist, not this one's.
     *
     * Which kinds gate the advance is NOT a column. `trip_documents` has no
     * `gates_advance` flag (and must not grow one): the set is the admin-
     * editable `config.advance_document_set`, which `payments.service.ts` and
     * `trips.service.ts` both already read live. A column here would fork that
     * — the advance gate would answer from config, Orders from the column, and
     * the day someone edits the list in the control panel the two would
     * silently disagree. `unique(trip_id, kind)` already makes `kind` a
     * document's identity on a trip, so matching on kind is also the natural
     * key rather than a parallel one.
     *
     * An empty set means nothing gates the advance, which is vacuously
     * satisfied — not "blocked forever".
     */
    let advanceDocsUploaded = false;
    if (trip) {
      if (advanceDocKinds.length === 0) {
        advanceDocsUploaded = true;
      } else {
        const present = await this.db
          .selectFrom('trip_documents')
          .select(['kind', 'status'])
          .where('trip_id', '=', trip.id)
          .where('kind', 'in', advanceDocKinds)
          .execute();
        // The rule itself lives in `order-ladder.ts` beside the ladder that
        // consumes it — this only supplies the rows.
        const byKind = new Map(present.map((d) => [d.kind, d.status]));
        advanceDocsUploaded = advanceDocsIn(advanceDocKinds, byKind);
      }
    }

    const invoice = trip
      ? await this.db
          .selectFrom('invoice_trips')
          .innerJoin('invoices', 'invoices.id', 'invoice_trips.invoice_id')
          .select(['invoices.id as id'])
          .where('invoice_trips.trip_id', '=', trip.id)
          .executeTakeFirst()
      : undefined;

    /*
     * `pod_status` is typed `string` on `TripsTable`, so it is narrowed to
     * `PodStatus` here, at the one boundary the ladder reads it through.
     *
     * The narrowing is not idle: it is what makes the exhaustive switch in
     * `ladder()` do its job. The database's own check constraint is what
     * guarantees the value really is one of the seven, so this asserts a fact
     * the schema already enforces rather than hoping.
     *
     * Deliberately not fixed by retyping `TripsTable.pod_status` — that column
     * is assigned from a computed variable in `pod.service.ts`, which another
     * session owns and is actively editing. Narrowing at my own boundary gets
     * the same compile-time guarantee without reaching into their file.
     */
    const narrowedTrip = trip ? { ...trip, podStatus: trip.podStatus as PodStatus } : null;

    return { indent, trip: narrowedTrip, advanceDocsUploaded, invoiceId: invoice?.id ?? null };
  }

  async writeStatus(
    orderId: string,
    patch: { status: OrderStatus; stepNo: number; tripId: string | null; invoiceId: string | null; closedAt: Date | null },
  ) {
    await this.db
      .updateTable('orders')
      .set({
        status: patch.status,
        step_no: patch.stepNo,
        trip_id: patch.tripId,
        invoice_id: patch.invoiceId,
        closed_at: patch.closedAt,
        updated_at: new Date(),
      })
      .where('id', '=', orderId)
      .execute();
  }

  async appendEvent(event: {
    orderId: string;
    status: OrderStatus;
    stepNo: number;
    actorUserId: string | null;
    note: string | null;
  }) {
    await this.db
      .insertInto('order_events')
      .values({
        order_id: event.orderId,
        status: event.status,
        step_no: event.stepNo,
        actor_user_id: event.actorUserId,
        note: event.note,
      })
      .execute();
  }

  /** The most recent recorded step, used to avoid appending a duplicate event. */
  async lastEventStatus(orderId: string): Promise<OrderStatus | null> {
    const row = await this.db
      .selectFrom('order_events')
      .select('status')
      .where('order_id', '=', orderId)
      .orderBy('at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return (row?.status as OrderStatus) ?? null;
  }

  /** Takes the executor so the caller can keep this in the same transaction
   *  as the number it just issued. */
  async insertOrder(
    trx: DbExecutor,
    row: { orderNo: string; indentId: string; clientId: string; branchId: string },
  ) {
    const created = await trx
      .insertInto('orders')
      .values({
        order_no: row.orderNo,
        indent_id: row.indentId,
        client_id: row.clientId,
        branch_id: row.branchId,
      })
      .returning(['id', 'order_no as orderNo'])
      .executeTakeFirstOrThrow();
    return created;
  }

  /** Orders whose history is empty — the migration's backfilled rows. */
  listNeedingRecompute(limit: number) {
    return this.db
      .selectFrom('orders')
      .select(['id', 'indent_id as indentId'])
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('order_events').select('id').whereRef('order_events.order_id', '=', 'orders.id'),
          ),
        ),
      )
      .limit(limit)
      .execute();
  }

  /**
   * Indents with no order row at all.
   *
   * The counterpart to the above, and the one that makes after-commit order
   * creation safe: if an indent commits and the `createForIndent` call that
   * follows it fails or was never wired, nothing else would ever notice —
   * `listNeedingRecompute` looks at orders, and there is no order to find.
   */
  listIndentsWithoutOrder(limit: number) {
    return this.db
      .selectFrom('indents')
      .select(['id as indentId'])
      .where((eb) =>
        eb.not(
          eb.exists(eb.selectFrom('orders').select('id').whereRef('orders.indent_id', '=', 'indents.id')),
        ),
      )
      .orderBy('created_at', 'asc')
      .limit(limit)
      .execute();
  }
}
