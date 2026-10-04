import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { OrderStatus } from '../../db/types';
import { advanceDocsIn, type PodStatus } from './order-ladder';

/** Everything except paging — what the list, its total and the tab counts share. */
export interface OrderSearchFilters {
  /** One step, or several separated by commas (a phase is several steps). Omitted means every step. */
  status?: string;
  branchId?: string;
  clientId?: string;
  /** `true` = not yet at BALANCE_RELEASED. */
  openOnly?: boolean;
  /** Free text over order number, indent code, trip code, client name and lane. */
  q?: string;
  /** Client details: name, client code, GST number, contact person or phone. */
  clientName?: string;
  /** Transporter's legal name. */
  vendor?: string;
  /** Pick-up city. */
  from?: string;
  /** Delivery city. */
  to?: string;
  /** Vehicle number — spaces and dashes are ignored, so "MH12AB1234" finds "MH 12 AB 1234". */
  truck?: string;
  /** A load-request, trip, lorry-receipt or invoice number. */
  ref?: string;
  branchName?: string;
}

export interface OrderListFilters extends OrderSearchFilters {
  limit: number;
  offset: number;
}

/** Lower-cased `%term%`, with LIKE's own wildcards made literal. */
function likeTerm(raw: string) {
  return `%${raw.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** The same term with spaces and dashes removed, for comparing vehicle numbers. */
function squashedLikeTerm(raw: string) {
  return likeTerm(raw.replace(/[\s-]/g, ''));
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

  /**
   * Every table a filter can reach, with nothing selected yet. The row query,
   * its total and the tab counts all start here, so a filter that narrows the
   * list narrows the count and the tabs by the same rule — a count built on
   * fewer joins would quietly ignore the vendor or truck filter.
   */
  private joined() {
    return this.db
      .selectFrom('orders')
      .innerJoin('indents', 'indents.id', 'orders.indent_id')
      .innerJoin('clients', 'clients.id', 'orders.client_id')
      .innerJoin('branches', 'branches.id', 'orders.branch_id')
      .leftJoin('trips', 'trips.id', 'orders.trip_id')
      .leftJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .leftJoin('invoices', 'invoices.id', 'orders.invoice_id');
  }

  /**
   * The WHERE clauses for a search. `skipStatus` is for the tab counts: each
   * tab shows how many orders *would* be in it, so the count must ignore
   * whichever step is currently selected and honour everything else.
   */
  private applyFilters<T extends { where: any }>(query: T, filters: OrderSearchFilters, skipStatus = false): T {
    let q: any = query;
    if (!skipStatus && filters.status) {
      const steps = filters.status.split(',').map((s) => s.trim()).filter(Boolean);
      if (steps.length === 1) q = q.where('orders.status', '=', steps[0]);
      else if (steps.length > 1) q = q.where('orders.status', 'in', steps);
    }
    if (filters.branchId) q = q.where('orders.branch_id', '=', filters.branchId);
    if (filters.clientId) q = q.where('orders.client_id', '=', filters.clientId);
    if (filters.openOnly) q = q.where('orders.closed_at', 'is', null);
    const lowered = (eb: any, column: string, term: string) => eb(eb.fn('lower', [column]), 'like', term);
    if (filters.q?.trim()) {
      const term = likeTerm(filters.q);
      q = q.where((eb: any) =>
        eb.or([
          lowered(eb, 'orders.order_no', term),
          lowered(eb, 'indents.code', term),
          lowered(eb, 'trips.code', term),
          lowered(eb, 'clients.name', term),
          lowered(eb, 'indents.from_city', term),
          lowered(eb, 'indents.to_city', term),
        ]),
      );
    }
    if (filters.clientName?.trim()) {
      const term = likeTerm(filters.clientName);
      q = q.where((eb: any) =>
        eb.or([
          lowered(eb, 'clients.name', term),
          lowered(eb, 'clients.code', term),
          lowered(eb, 'clients.gstin', term),
          lowered(eb, 'clients.contact', term),
          lowered(eb, 'clients.phone', term),
        ]),
      );
    }
    if (filters.vendor?.trim()) q = q.where((eb: any) => lowered(eb, 'vendors.legal_name', likeTerm(filters.vendor!)));
    if (filters.from?.trim()) q = q.where((eb: any) => lowered(eb, 'indents.from_city', likeTerm(filters.from!)));
    if (filters.to?.trim()) q = q.where((eb: any) => lowered(eb, 'indents.to_city', likeTerm(filters.to!)));
    if (filters.branchName?.trim()) q = q.where((eb: any) => lowered(eb, 'branches.name', likeTerm(filters.branchName!)));
    if (filters.truck?.trim()) {
      // Vehicle numbers are typed every which way, so compare with the spaces
      // and dashes taken out of both sides.
      const term = squashedLikeTerm(filters.truck);
      q = q.where((eb: any) =>
        eb(eb.fn('replace', [eb.fn('replace', [eb.fn('lower', ['trips.vehicle_no']), eb.val(' '), eb.val('')]), eb.val('-'), eb.val('')]), 'like', term),
      );
    }
    if (filters.ref?.trim()) {
      const term = likeTerm(filters.ref);
      q = q.where((eb: any) =>
        eb.or([
          lowered(eb, 'indents.code', term),
          lowered(eb, 'trips.code', term),
          lowered(eb, 'invoices.code', term),
          // A subquery, not a join: a join here would repeat an order once per
          // lorry receipt and inflate both the list and its total.
          eb.exists(
            eb
              .selectFrom('lorry_receipts')
              .select('lorry_receipts.id')
              .whereRef('lorry_receipts.trip_id', '=', 'trips.id')
              .where(eb.fn('lower', ['lorry_receipts.code']), 'like', term),
          ),
        ]),
      );
    }
    return q as T;
  }

  private baseQuery() {
    return this.joined()
      .select([
        'orders.id as id',
        'orders.order_no as orderNo',
        'orders.status as status',
        'orders.step_no as stepNo',
        'orders.closed_at as closedAt',
        'orders.created_at as createdAt',
        'orders.branch_id as branchId',
        'orders.client_id as clientId',
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
        'indents.remarks as remarks',
        'clients.name as clientName',
        'branches.name as branchName',
        'trips.id as tripId',
        'trips.code as tripCode',
        'trips.vehicle_no as vehicleNo',
        'trips.driver_name as driverName',
        'trips.driver_phone as driverPhone',
        'trips.buy_rate as buyRatePaise',
        'trips.advance_paid as advancePaidPaise',
        'trips.balance_paid as balancePaidPaise',
        'vendors.legal_name as vendorName',
        'vendors.code as vendorCode',
        'vendors.phone as vendorPhone',
        'indents.pickup_address as pickupAddress',
        'indents.drop_address as dropAddress',
        'trips.stage as tripStage',
        'trips.reached_loading_at as reachedLoadingAt',
        'trips.loading_completed_at as loadedAt',
        'trips.departed_at as departedAt',
        'trips.reached_destination_at as reachedDestinationAt',
        'trips.delivered_at as deliveredAt',
        'trips.pod_status as podStatus',
        'invoices.id as invoiceId',
        'invoices.code as invoiceCode',
        'invoices.status as invoiceStatus',
        'invoices.invoice_date as invoiceDate',
        'invoices.total as invoiceTotalPaise',
        'invoices.received as invoiceReceivedPaise',
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
    const rows = await this.applyFilters(this.baseQuery(), filters)
      .orderBy('orders.created_at', 'desc')
      .limit(filters.limit)
      .offset(filters.offset)
      .execute();

    const counted = await this.applyFilters(
      this.joined().select((eb) => eb.fn.countAll<string>().as('total')),
      filters,
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

  /**
   * Counts per step, for the phase tabs — one query, not one per tab.
   *
   * Takes the same filters as the list, minus the step itself: with a vendor
   * or a city typed in, each tab should say how many of *those* orders sit in
   * it, not how many exist in total.
   */
  async countsByStatus(filters: OrderSearchFilters = {}) {
    const rows = await this.applyFilters(
      this.joined().select((eb) => ['orders.status as status', eb.fn.countAll<string>().as('count')]),
      filters,
      true,
    )
      .groupBy('orders.status')
      .execute();
    return rows.reduce<Record<string, number>>((acc, r: any) => {
      acc[r.status] = Number(r.count);
      return acc;
    }, {});
  }

  comments(orderId: string) {
    return this.db
      .selectFrom('order_comments')
      .innerJoin('users', 'users.id', 'order_comments.author_user_id')
      .select([
        'order_comments.id as id',
        'order_comments.body as body',
        'order_comments.created_at as at',
        'users.name as authorName',
      ])
      .where('order_comments.order_id', '=', orderId)
      .orderBy('order_comments.created_at', 'asc')
      .execute();
  }

  addComment(orderId: string, authorUserId: string, body: string) {
    return this.db
      .insertInto('order_comments')
      .values({ order_id: orderId, author_user_id: authorUserId, body })
      .returning(['id'])
      .executeTakeFirstOrThrow();
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
        'users.phone as actorPhone',
      ])
      .where('order_events.order_id', '=', orderId)
      .orderBy('order_events.at', 'asc')
      .execute();
  }

  /**
   * Who allocated the truck, and when — read from the audit trail, since
   * allocating a vehicle is not a step of its own on the ladder. The latest
   * one, so a swapped truck shows whoever put the current one on.
   */
  vehicleAllocation(indentId: string) {
    return this.db
      .selectFrom('audit_events')
      .leftJoin('users', 'users.id', 'audit_events.actor_id')
      .select(['audit_events.at as at', 'users.name as byName', 'users.phone as byPhone'])
      .where('audit_events.entity_type', '=', 'indents')
      .where('audit_events.entity_id', '=', indentId)
      .where('audit_events.action', '=', 'STATUS_CHANGE')
      .where(sql<boolean>`audit_events.after->>'vehicleNo' is not null`)
      .orderBy('audit_events.at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /** E-POD or H-POD — how the proof on this trip came in, once one has. */
  async podKind(tripId: string) {
    const row = await this.db
      .selectFrom('pod_receipts')
      .select(['pod_kind as podKind'])
      .where('trip_id', '=', tripId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    return row?.podKind ?? null;
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
        advanceDocsUploaded = advanceDocsIn(advanceDocKinds, byKind, !!trip.lrCode);
      }
    }

    const invoice = trip
      ? await this.db
          .selectFrom('invoice_trips')
          .innerJoin('invoices', 'invoices.id', 'invoice_trips.invoice_id')
          .select(['invoices.id as id'])
          .where('invoice_trips.trip_id', '=', trip.id)
          // A load re-invoiced after a cancellation is on two invoices — the live one is the order's.
          .orderBy(sql`invoices.status = 'CANCELLED'`)
          .orderBy('invoices.created_at', 'desc')
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
    row: { indentId: string; clientId: string; branchId: string },
  ) {
    const created = await trx
      .insertInto('orders')
      .values({
        // There is no order id of its own: the order carries its indent's id.
        order_no: sql<string>`(select code from indents where id = ${row.indentId})`,
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
   * Money that has actually moved against a trip — every advance and balance
   * payment with its UTR, newest first. Read from `payments` rather than
   * inferred from `trips.advance_paid`/`balance_paid`, because those two
   * columns hold an amount and this has to say *which transfer* it was.
   */
  paymentsForTrip(tripId: string) {
    return this.db
      .selectFrom('payments')
      .leftJoin('users', 'users.id', 'payments.released_by')
      .select([
        'payments.kind as kind',
        'payments.gross as grossPaise',
        'payments.penalty as penaltyPaise',
        'payments.deduction as deductionPaise',
        'payments.net as netPaise',
        'payments.mode as mode',
        'payments.utr as utr',
        'payments.value_date as valueDate',
        'payments.released_at as releasedAt',
        'users.name as releasedByName',
      ])
      .where('payments.trip_id', '=', tripId)
      .orderBy('payments.released_at', 'desc')
      .execute();
  }

  /** Every charge line on a trip, as what it cost us — BR-45, never `billed_amount`. */
  chargesForTrip(tripId: string) {
    return this.db
      .selectFrom('trip_charges')
      .select(['charge_type as chargeType', 'cost_amount as costPaise'])
      .where('trip_id', '=', tripId)
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
