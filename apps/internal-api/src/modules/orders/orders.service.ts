import { Injectable, NotFoundException } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import { NumberingService } from '../numbering/numbering.service';
import { ConfigRepository } from '../config/config.repository';
import { OrdersRepository, type OrderListFilters, type OrderSearchFilters } from './orders.repository';
import { ladder as pureLadder, isTerminal, stepNoFor } from './order-ladder';
import { buildOrderPayments } from './order-payments';
import type { OrderStatus } from '../../db/types';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

/**
 * The ladder itself lives in `order-ladder.ts` — a pure, dependency-free
 * module — and is re-exported here so existing importers keep working.
 *
 * It was extracted for one reason: the portal's fixture adapter carries a
 * mirror of the same ten decisions, and two copies drift silently. A
 * dependency-free file can be imported by the portal's test suite, so the same
 * scenarios run through both implementations and fail the day they disagree.
 */
export { ORDER_LADDER, stepNoFor } from './order-ladder';

@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly numbering: NumberingService,
    private readonly configRepository: ConfigRepository,
  ) {}

  /**
   * The kinds of document that gate an advance, read live from config — the
   * same source `payments.service.ts` and `trips.service.ts` use. Read on each
   * recompute rather than cached, so editing the list in the control panel
   * takes effect without a restart.
   */
  private async advanceDocumentSet(): Promise<string[]> {
    const config = await this.configRepository.findAll();
    const raw = config.get('advance_document_set');
    return Array.isArray(raw) ? (raw as string[]) : [];
  }

  /**
   * Where this order stands, from the records behind it.
   *
   * The decisions live in `ladder()` in `order-ladder.ts`; this only shapes
   * the repository's rows into the facts it asks for. Keeping the decisions in
   * a file with no dependencies is what lets them be tested — and tested
   * against the fixture's mirror — without a module or a database.
   */
  private ladder(inputs: NonNullable<Awaited<ReturnType<OrdersRepository['ladderInputs']>>>): OrderStatus {
    return pureLadder({
      indentStage: inputs.indent.stage,
      failureCause: inputs.indent.failureCause,
      trip: inputs.trip
        ? {
            stage: inputs.trip.stage,
            podStatus: inputs.trip.podStatus,
            advancePaidPaise: inputs.trip.advancePaidPaise,
            balancePaidPaise: inputs.trip.balancePaidPaise,
            lrCode: inputs.trip.lrCode ?? null,
          }
        : null,
      advanceDocsUploaded: inputs.advanceDocsUploaded,
    });
  }

  /**
   * Recompute one order from its underlying facts, and record the step if it
   * changed. Safe to call as often as you like — it writes only on a change,
   * so wiring it into a hot path costs one read and nothing else.
   */
  async recompute(indentId: string, actor: AuthenticatedUser | null = null, note: string | null = null) {
    const inputs = await this.repo.ladderInputs(indentId, await this.advanceDocumentSet());
    if (!inputs) return null;

    let order = await this.repo.getByIndentId(indentId);
    if (!order) order = (await this.createForIndent(indentId, actor)) ?? undefined;
    if (!order) return null;

    const status = this.ladder(inputs);
    const stepNo = stepNoFor(status);
    // Both terminal exits close the order — a forfeited one is finished
    // just as surely as a settled one, and leaving it open would park it in
    // the "still live" queue for ever.
    const closedAt = isTerminal(status) ? new Date() : null;

    const changed = order.status !== status;
    if (changed || order.tripId !== inputs.trip?.id || order.invoiceId !== inputs.invoiceId) {
      await this.repo.writeStatus(order.id, {
        status,
        stepNo,
        tripId: inputs.trip?.id ?? null,
        invoiceId: inputs.invoiceId,
        // Preserve the original closure timestamp rather than stamping a new
        // one every recompute after the order settled.
        closedAt: isTerminal(status) ? (order.closedAt ?? closedAt) : null,
      });
    }

    // Append on genuine movement only. Recomputing an unchanged order must not
    // add a history row, or the timeline fills with duplicates of the step it
    // is already on.
    const lastRecorded = await this.repo.lastEventStatus(order.id);
    if (lastRecorded !== status) {
      await this.repo.appendEvent({
        orderId: order.id,
        status,
        stepNo,
        actorUserId: actor?.userId ?? null,
        note,
      });
    }

    return { ...order, status, stepNo };
  }

  /** Creates the order for an indent that does not have one yet. */
  async createForIndent(indentId: string, actor: AuthenticatedUser | null = null) {
    const inputs = await this.repo.ladderInputs(indentId, await this.advanceDocumentSet());
    if (!inputs) return null;

    const existing = await this.repo.getByIndentId(indentId);
    if (existing) return existing;

    await this.repo.transaction().execute(async (trx) => {
      await this.repo.insertOrder(trx, {
        indentId,
        clientId: inputs.indent.clientId,
        branchId: inputs.indent.branchId,
      });
    });

    const created = await this.repo.getByIndentId(indentId);
    if (created) {
      await this.repo.appendEvent({
        orderId: created.id,
        status: 'INDENT_CREATED',
        stepNo: 1,
        actorUserId: actor?.userId ?? null,
        note: null,
      });
    }
    return created ?? null;
  }

  async list(filters: OrderListFilters) {
    const { rows, total } = await this.repo.list(filters);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        orderNo: r.orderNo,
        indentId: r.indentId,
        indentCode: r.indentCode,
        clientName: r.clientName,
        lane: `${r.fromCity} → ${r.toCity}`,
        fromCity: r.fromCity,
        toCity: r.toCity,
        vendorName: r.vendorName,
        vehicleNo: r.vehicleNo,
        pickupDate: r.pickupDate,
        sellRatePaise: r.sellRatePaise,
        branchName: r.branchName,
        status: r.status,
        stepNo: r.stepNo,
        tripId: r.tripId,
        tripCode: r.tripCode,
        invoiceCode: r.invoiceCode,
        failureCause: r.failureCause,
        closedAt: r.closedAt,
      })),
      total,
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  async counts(filters: OrderSearchFilters = {}) {
    return this.repo.countsByStatus(filters);
  }

  /**
   * `ref` is deliberately whatever the caller has on hand — the order's own
   * id, its indent's id, or its indent's code — matching the flexible `ref`
   * resolution `payments.service.ts` already uses for the same reason: a
   * "View order" link is built from whatever identifier the linking screen
   * happens to be holding (trip/POD/payment pages pass indentCode; the
   * indent detail page passes its own id), never the order's own id, which
   * no other screen knows.
   */
  async getById(ref: string, user?: AuthenticatedUser) {
    const order =
      (await this.repo.getById(ref)) ??
      (await this.repo.getByIndentId(ref)) ??
      (await this.repo.getByIndentCode(ref));
    if (!order) throw new NotFoundException('Order not found');
    const [events, comments] = await Promise.all([this.repo.events(order.id), this.repo.comments(order.id)]);

    // Margin is the one figure here that is not simply "what was on the
    // records": it follows the Profit and loss rule for who may see it —
    // everything with `pnl.view_all`, own branch only with `pnl.view_own`.
    // The rates and the money that moved are already visible to anyone who can
    // read the order, so they are not gated.
    const level = (code: string) => user?.permissions.get(code) ?? 'NONE';
    const canSeeMargin =
      !!user &&
      (level('pnl.view_all') !== 'NONE' ||
        (level('pnl.view_own') !== 'NONE' && user.branch?.id === order.branchId));
    const [paid, charges] = order.tripId
      ? await Promise.all([this.repo.paymentsForTrip(order.tripId), this.repo.chargesForTrip(order.tripId)])
      : [[], []];
    const payments = buildOrderPayments({
      sourcingRatePaise: order.buyRatePaise,
      placementRatePaise: order.sellRatePaise,
      charges,
      payments: paid.map((p) => ({ ...p, kind: p.kind as 'ADVANCE' | 'BALANCE' })),
      canSeeMargin,
    });

    return {
      id: order.id,
      orderNo: order.orderNo,
      indentId: order.indentId,
      indentCode: order.indentCode,
      clientId: order.clientId,
      clientName: order.clientName,
      lane: `${order.fromCity} → ${order.toCity}`,
      fromCity: order.fromCity,
      toCity: order.toCity,
      pickupDate: order.pickupDate,
      sellRatePaise: order.sellRatePaise,
      branchName: order.branchName,
      status: order.status,
      stepNo: order.stepNo,
      tripId: order.tripId,
      tripCode: order.tripCode,
      invoiceId: order.invoiceId,
      invoiceCode: order.invoiceCode,
      failureCause: order.failureCause,
      closedAt: order.closedAt,
      material: order.material,
      weightTn: order.weightKg / 1000,
      truckType: order.truckType,
      vendorName: order.vendorName,
      vehicleNo: order.vehicleNo,
      driverName: order.driverName,
      driverPhone: order.driverPhone,
      buyRatePaise: order.buyRatePaise,
      advancePaidPaise: order.advancePaidPaise ?? 0,
      balancePaidPaise: order.balancePaidPaise ?? 0,
      // The indent's own special instructions ("stack no more than three
      // high", a gate-closing time) — carried unchanged into the lorry
      // receipt's own Remarks field already; surfaced here too as the order
      // page's Comments tab, so it doesn't take opening the LR to read it.
      remarks: order.remarks,
      // Everything about the order on its Details tab: where it loads and
      // delivers, who carries it, where the truck has got to, and the invoice.
      pickupAddress: order.pickupAddress ?? null,
      dropAddress: order.dropAddress ?? null,
      vendorCode: order.vendorCode ?? null,
      vendorPhone: order.vendorPhone ?? null,
      tripStage: order.tripStage ?? null,
      milestones: {
        reachedLoadingAt: order.reachedLoadingAt ?? null,
        loadedAt: order.loadedAt ?? null,
        departedAt: order.departedAt ?? null,
        reachedDestinationAt: order.reachedDestinationAt ?? null,
        deliveredAt: order.deliveredAt ?? null,
      },
      podStatus: order.podStatus ?? null,
      invoice: order.invoiceId
        ? {
            id: order.invoiceId,
            code: order.invoiceCode,
            status: order.invoiceStatus,
            invoiceDate: order.invoiceDate,
            totalPaise: Number(order.invoiceTotalPaise ?? 0),
            receivedPaise: Number(order.invoiceReceivedPaise ?? 0),
          }
        : null,
      payments,
      events,
      comments,
    };
  }

  /**
   * Adds a note to an order — a remark or a detail somebody wants on record
   * as the load moves. Append-only: a comment is what was said at the time.
   */
  async addComment(ref: string, body: string, user: AuthenticatedUser) {
    const text = (body ?? '').trim();
    if (!text) throw new DomainException(400, 'VALIDATION_ERROR', 'Write something before adding the comment.');
    if (text.length > 2000) throw new DomainException(400, 'VALIDATION_ERROR', 'Keep a comment under 2,000 characters.');
    const order =
      (await this.repo.getById(ref)) ?? (await this.repo.getByIndentId(ref)) ?? (await this.repo.getByIndentCode(ref));
    if (!order) throw new NotFoundException('Order not found');
    await this.repo.addComment(order.id, user.userId, text);
    return this.repo.comments(order.id);
  }

  /**
   * Makes the orders table agree with reality, and repairs it where it does
   * not. Safe to run repeatedly; safe to run on a schedule.
   *
   * Two jobs, and the second is what makes after-commit wiring safe:
   *
   * 1. **Backfilled rows.** The migration inserts one order per existing
   *    indent at `INDENT_CREATED` without computing the ladder — writing that
   *    ladder in SQL as well as in `ladder()` is exactly the duplication this
   *    whole change exists to remove. So the rows land with no history and
   *    this walks them through `recompute()` once.
   *
   * 2. **Indents with no order at all.** Orders are created *after* the
   *    indent's own transaction commits, because `createForIndent` opens its
   *    own transaction and calling it inside the caller's would read
   *    pre-commit state. That ordering is right, but it leaves a gap: if the
   *    creating call fails — or was never wired at a new call site — the
   *    indent exists and its order silently does not, and nothing downstream
   *    would ever notice, because every other repair path starts from an
   *    order row. This starts from the indent instead.
   *
   * Net effect: a missed or failed hook degrades to "the order appears late"
   * rather than "the order never exists", which is the difference between a
   * delay and a permanent hole.
   */
  async reconcile(limit = 500) {
    const missing = await this.repo.listIndentsWithoutOrder(limit);
    let created = 0;
    for (const row of missing) {
      const order = await this.createForIndent(row.indentId, null);
      if (order) created += 1;
    }

    const stale = await this.repo.listNeedingRecompute(limit);
    let updated = 0;
    for (const row of stale) {
      const result = await this.recompute(row.indentId, null, 'Reconciled from existing records');
      if (result) updated += 1;
    }

    return { indentsWithoutOrder: missing.length, created, examined: stale.length, updated };
  }

  /** @deprecated Use `reconcile()` — it also repairs indents with no order. */
  async reconcileBackfilled(limit = 500) {
    return this.reconcile(limit);
  }
}
