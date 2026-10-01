import { Injectable, Logger } from '@nestjs/common';
import { DomainException, type UnmetItem } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { DbExecutor } from '../../db/kysely';
import { AuditService } from '../audit/audit.service';
import { ConfigRepository } from '../config/config.repository';
import { OrdersService } from '../orders/orders.service';
import { PaymentsRepository } from './payments.repository';
import type { ReleasePaymentDto } from './dto/release-payment.dto';
import type { AcceptBillDto } from './dto/accept-bill.dto';
import type { RaiseBillDto } from './dto/raise-bill.dto';
import { assertAnyPermission } from '../../common/guards/assert-any-permission';
import { planRecovery } from '../sdr/sdr-recovery';
import { SdrRepository } from '../sdr/sdr.repository';
import { TripsService } from '../trips/trips.service';

const DOC_LABEL: Record<string, string> = {
  CLIENT_INVOICE_OR_PO: 'Client invoice or purchase order',
  EWAY_BILL: 'E-way bill',
  RC: 'Registration certificate',
  INSURANCE: 'Goods insurance',
  FITNESS: 'Fitness certificate',
  PERMIT: 'Permit',
  PUC: 'Pollution certificate',
  DRIVING_LICENCE: 'Driving licence',
  LOADING_SLIP: 'Loading slip',
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly configRepository: ConfigRepository,
    private readonly auditService: AuditService,
    private readonly ordersService: OrdersService,
    private readonly sdrRepository: SdrRepository,
    private readonly tripsService: TripsService,
  ) {}

  private readonly logger = new Logger('PaymentsService');

  /**
   * Moves the ten-step order ladder after a release has COMMITTED.
   * See `TripsService.syncOrder` for why this runs outside the transaction and
   * why a failure is logged rather than thrown — doubly so here, where the
   * money has already moved and the UTR is already recorded.
   */
  private async syncOrder(
    indentId: string | null | undefined,
    actor: AuthenticatedUser | null,
    note: string | null = null,
  ) {
    if (!indentId) return;
    try {
      await this.ordersService.recompute(indentId, actor, note);
    } catch (e) {
      this.logger.error(
        `Order recompute failed for indent ${indentId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ---- Advance ----------------------------------------------------------

  async advanceQueue(status?: string) {
    const rows = await this.paymentsRepository.advanceQueue(status);
    const withUnmet = await Promise.all(
      rows.map(async (r) => {
        const unmet = await this.advanceUnmet(r.tripId);
        return {
          indentId: r.indentId,
          indentCode: r.indentCode,
          tripId: r.tripId,
          tripCode: r.tripCode,
          vendorName: r.vendorName,
          lane: r.lane,
          branchName: r.branchName,
          advancePct: r.advancePct,
          grossPaise: Math.round((r.buyRate * r.advancePct) / 100),
          blocked: unmet.length > 0 || r.advancePaid > 0,
          unmetCount: unmet.length,
        };
      }),
    );
    return withUnmet;
  }

  async advanceGate(ref: string) {
    const trip = await this.resolveTripForAdvance(ref);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown indent or trip: ${ref}`);

    const indent = await this.paymentsRepository.resolveIndentById(trip.indent_id);
    if (!indent) throw new DomainException(404, 'NOT_FOUND', `Trip ${trip.id} has no indent.`);

    const vendor = await this.vendorBeneficiary(trip.vendor_id);
    const unmet = await this.advanceUnmet(trip.id);
    const cleared = await this.advanceCleared(trip.id);
    const grossPaise = Math.round((trip.buy_rate * indent.advance_pct) / 100);

    return {
      tripId: trip.id,
      tripCode: trip.code,
      indentCode: indent.code,
      vendorName: vendor.name,
      beneficiary: vendor.beneficiary,
      advancePct: indent.advance_pct,
      buyRatePaise: trip.buy_rate,
      grossPaise,
      tdsPaise: 0, // BR-33: never deducted at this release.
      netPaise: grossPaise,
      unmet,
      cleared,
      releasable: unmet.length === 0 && trip.advance_paid === 0,
      alreadyReleased: trip.advance_paid > 0,
    };
  }

  async releaseAdvance(ref: string, dto: ReleasePaymentDto, idempotencyKey: string, actor: AuthenticatedUser) {
    this.assertPaymentFields(dto);

    // Stays null on the idempotent replay path, where nothing changed and the
    // ladder therefore has nothing to move.
    let indentId: string | null = null;
    const result = await this.paymentsRepository.transaction().execute(async (trx) => {
      const existing = await this.paymentsRepository.findByIdempotencyKeyForUpdate(trx, idempotencyKey);
      if (existing) return this.paymentDto(existing);

      const trip = await this.resolveTripForAdvance(ref);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown indent or trip: ${ref}`);
      const lockedTrip = await this.paymentsRepository.findTripForUpdate(trx, trip.id);
      if (!lockedTrip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${trip.id}`);
      if (lockedTrip.advance_paid > 0) {
        throw new DomainException(409, 'ADVANCE_ALREADY_RELEASED', 'The advance has already been released for this trip.');
      }

      const indent = await this.paymentsRepository.resolveIndentById(lockedTrip.indent_id);
      if (!indent) throw new DomainException(404, 'NOT_FOUND', `Trip ${lockedTrip.id} has no indent.`);
      indentId = indent.id;

      const unmet = await this.advanceUnmet(lockedTrip.id);
      if (unmet.length > 0) {
        throw new DomainException(409, 'ADVANCE_BLOCKED', 'The advance is blocked by unverified documents.', { unmet });
      }

      const grossPaise = Math.round((lockedTrip.buy_rate * indent.advance_pct) / 100);
      const payment = await this.paymentsRepository.insertPayment(trx, {
        tripId: lockedTrip.id,
        indentId: indent.id,
        kind: 'ADVANCE',
        gross: grossPaise,
        penalty: 0,
        mode: dto.mode,
        transferType: dto.transferType,
        remittingAccount: dto.remittingAccount,
        utr: dto.utr,
        valueDate: dto.valueDate,
        releasedBy: actor.userId,
        idempotencyKey,
      });

      await this.paymentsRepository.updateTrip(trx, lockedTrip.id, { advance_paid: grossPaise });
      await this.auditService.record(trx, actor, {
        action: 'PAYMENT',
        entityType: 'payments',
        entityId: payment.id,
        after: { kind: 'ADVANCE', tripId: lockedTrip.id, grossPaise },
      });

      return this.paymentDto(payment);
    });
    // Step 5, "Advance paid".
    await this.syncOrder(indentId, actor);
    // Advance uploaded, verified and paid: the order moves to tracking. The
    // operations team found orders sitting at "Advance paid" with a loaded
    // truck already gone, because nobody pressed Start trip. If the truck is
    // loaded and nothing else holds it, it goes on the road now; otherwise the
    // order's Next step still says what is missing.
    if (indentId) {
      const tripId = (result as { tripId?: string }).tripId;
      if (tripId) await this.tripsService.departIfReady(tripId, actor);
    }
    return result;
  }

  // ---- Balance ------------------------------------------------------

  async balanceQueue() {
    const rows = await this.paymentsRepository.balanceQueue();
    return Promise.all(
      rows.map(async (r) => {
        const chargeCost = await this.paymentsRepository.chargeCostTotal(r.tripId);
        const billable = r.buyRate + Number(chargeCost.total);
        const gross = billable - r.advancePaid;
        const penalty = r.podClosureBasis === 'WAIVED' ? 0 : r.podPenalty;
        const transitPenalty = Number(r.transitPenalty ?? 0);
        const podAgeDays = r.podReceivedAt ? this.daysBetween(r.podReceivedAt, new Date().toISOString()) : null;
        const unmet = await this.balanceUnmet(r.tripId, r.podStatus, r.podClosureBasis);
        const sdr = await this.sdrPlan(this.paymentsRepository.executor(), r.tripId, r.vendorId, gross - penalty - transitPenalty);
        return {
          tripId: r.tripId,
          tripCode: r.tripCode,
          vendorName: r.vendorName,
          lane: r.lane,
          branchName: r.branchName,
          podStatus: r.podStatus,
          podAgeDays,
          netPaise: sdr.netPaise,
          penaltyPaise: penalty,
          transitPenaltyPaise: transitPenalty,
          sdrDeductionPaise: sdr.totalPaise,
          blocked: unmet.length > 0 || r.balancePaid > 0,
          unmetCount: unmet.length,
        };
      }),
    );
  }

  async balanceGate(tripId: string) {
    const trip = await this.paymentsRepository.resolveByTripId(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

    const indent = await this.paymentsRepository.resolveIndentById(trip.indent_id);
    if (!indent) throw new DomainException(404, 'NOT_FOUND', `Trip ${trip.id} has no indent.`);
    const vendor = await this.vendorBeneficiary(trip.vendor_id);
    const chargeCost = await this.paymentsRepository.chargeCostTotal(tripId);
    const billablePaise = trip.buy_rate + Number(chargeCost.total);
    const grossPaise = billablePaise - trip.advance_paid;
    const penaltyConfig = await this.penaltyLabelConfig();
    const podAgeDays = trip.pod_received_at ? this.daysBetween(trip.pod_received_at, new Date().toISOString()) : null;
    const penaltyDays =
      trip.pod_closure_basis === 'WAIVED' || penaltyConfig.perDayPaise === 0
        ? 0
        : Math.round(trip.pod_penalty / Math.max(1, penaltyConfig.perDayPaise));
    const penaltyPaise = trip.pod_closure_basis === 'WAIVED' ? 0 : trip.pod_penalty;
    const transitPenaltyPaise = Number(trip.transit_penalty ?? 0);
    const transitLateDays =
      trip.actual_transit_days != null && trip.transit_days_required != null
        ? Math.max(0, trip.actual_transit_days - trip.transit_days_required)
        : 0;

    const unmet = await this.balanceUnmet(trip.id, trip.pod_status, trip.pod_closure_basis);
    const sdr = await this.sdrPlan(
      this.paymentsRepository.executor(),
      trip.id,
      trip.vendor_id,
      grossPaise - penaltyPaise - transitPenaltyPaise,
    );

    return {
      tripId: trip.id,
      tripCode: trip.code,
      indentCode: indent.code,
      vendorName: vendor.name,
      lane: trip.lane,
      beneficiary: vendor.beneficiary,
      podStatus: trip.pod_status,
      podAgeDays,
      breakdown: {
        billablePaise,
        buyRatePaise: trip.buy_rate,
        chargeCostPaise: Number(chargeCost.total),
        advancePaidPaise: trip.advance_paid,
        penaltyPaise,
        penaltyDays,
        penaltyPerDayPaise: penaltyConfig.perDayPaise,
        transitPenaltyPaise,
        transitLateDays,
        grossPaise,
        sdrDeductionPaise: sdr.totalPaise,
        sdrLines: sdr.recoveries.map((r) => ({
          code: r.sdrCode,
          tripCode: r.tripCode,
          amountPaise: r.amountPaise,
          carriedForward: !r.ownTrip,
          remainingAfterPaise: r.remainingAfterPaise,
        })),
        carriedForwardPaise: sdr.carriedForwardPaise,
        netPaise: sdr.netPaise,
      },
      unmet,
      releasable: unmet.length === 0 && trip.balance_paid === 0,
      alreadyReleased: trip.balance_paid > 0,
    };
  }

  async releaseBalance(tripId: string, dto: ReleasePaymentDto, idempotencyKey: string, actor: AuthenticatedUser) {
    this.assertPaymentFields(dto);

    // Null on the idempotent replay path, and on the forfeiture path below —
    // that one throws, so its writes roll back and there is nothing to move.
    let indentId: string | null = null;
    const result = await this.paymentsRepository.transaction().execute(async (trx) => {
      const existing = await this.paymentsRepository.findByIdempotencyKeyForUpdate(trx, idempotencyKey);
      if (existing) return this.paymentDto(existing);

      const trip = await this.paymentsRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

      const outcome = await this.releaseBalanceForTrip(trx, trip, null, dto, idempotencyKey, actor);
      indentId = outcome.indentId;
      return outcome.payment;
    });
    // Step 10, "Balance released" — the last rung. `recompute` stamps
    // `closed_at` when it lands here, which is what makes an order "settled".
    await this.syncOrder(indentId, actor);
    return result;
  }

  /**
   * The actual balance-release write — forfeiture check, the unmet-conditions
   * gate, the billable/gross/penalty computation, the payment insert and the
   * trip update. Shared by `releaseBalance` (the direct queue) and
   * `acceptBill` (accepting a transporter's bill releases the same balance,
   * at either the system-computed or the transporter's own figure) so the
   * two paths can never again compute two different numbers for the same
   * trip — before this, accepting a bill only flipped its status and never
   * actually paid anyone, contradicting both the spec and the dialog's own
   * "Accept and release" label.
   *
   * `billableOverride`, when given, replaces the buy-rate-plus-charges
   * computation with the transporter's own billed total — "accept at their
   * figure". The advance deduction and the POD penalty still apply exactly
   * as they do on the direct release path; only the billable base changes.
   */
  private async releaseBalanceForTrip(
    trx: DbExecutor,
    trip: {
      id: string;
      indent_id: string | null;
      balance_paid: number;
      pod_received_at: string | null;
      pod_closure_basis: string | null;
      pod_status: string;
      pod_penalty: number;
      transit_penalty: number;
      buy_rate: number;
      advance_paid: number;
      vendor_id: string;
      billed: boolean;
    },
    billableOverride: number | null,
    dto: ReleasePaymentDto,
    idempotencyKey: string,
    actor: AuthenticatedUser,
  ) {
    if (trip.balance_paid > 0) {
      throw new DomainException(409, 'BALANCE_ALREADY_RELEASED', 'The balance has already been released for this trip.');
    }

    const penaltyConfig = await this.penaltyLabelConfig();
    const ageDays = trip.pod_received_at ? this.daysBetween(trip.pod_received_at, new Date().toISOString()) : 0;
    // BR-25: past 40 days, nothing is payable — the trip closes.
    if (ageDays > penaltyConfig.forfeitDays && trip.pod_closure_basis !== 'WAIVED') {
      await this.paymentsRepository.updateTrip(trx, trip.id, {
        pod_status: 'FORFEITED',
        pod_closure_basis: 'FORFEITED',
        stage: 'CLOSED',
      });
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'trips',
        entityId: trip.id,
        after: { podStatus: 'FORFEITED', stage: 'CLOSED' },
      });
      throw new DomainException(409, 'POD_FORFEITED', 'This POD is past the forfeiture window; nothing is payable.');
    }

    const unmet = await this.balanceUnmet(trip.id, trip.pod_status, trip.pod_closure_basis, trx);
    if (unmet.length > 0) {
      throw new DomainException(409, 'BALANCE_BLOCKED', 'The balance is blocked.', { unmet });
    }

    const chargeCost = await this.paymentsRepository.chargeCostTotal(trip.id);
    const billable = billableOverride ?? trip.buy_rate + Number(chargeCost.total);
    const gross = billable - trip.advance_paid;
    const podPenalty = trip.pod_closure_basis === 'WAIVED' ? 0 : trip.pod_penalty;
    // The penalty on the payment is late paperwork plus late delivery.
    const penalty = podPenalty + Number(trip.transit_penalty ?? 0);

    // Shortage/damage deductions come off before anything is paid, this trip's
    // own records first and then any carried forward from the transporter's
    // earlier trips. Whatever the balance cannot cover stays outstanding.
    const sdr = await this.sdrPlan(trx, trip.id, trip.vendor_id, gross - penalty, true);

    const payment = await this.paymentsRepository.insertPayment(trx, {
      tripId: trip.id,
      indentId: null,
      kind: 'BALANCE',
      gross,
      penalty,
      deduction: sdr.totalPaise,
      mode: dto.mode,
      transferType: dto.transferType,
      remittingAccount: dto.remittingAccount,
      utr: dto.utr,
      valueDate: dto.valueDate,
      releasedBy: actor.userId,
      idempotencyKey,
    });

    for (const r of sdr.recoveries) {
      await this.sdrRepository.insertRecovery(trx, {
        sdrId: r.sdrId,
        tripId: trip.id,
        paymentId: payment.id,
        amountPaise: r.amountPaise,
      });
      await this.sdrRepository.reduceOutstanding(trx, r.sdrId, r.amountPaise);
    }

    // Paying the transporter says nothing about billing the client: `billed` is set
    // by the invoice, and the trip stays open to be invoiced until it has been. It
    // closes once both halves are done — the transporter paid and the client billed.
    await this.paymentsRepository.updateTrip(trx, trip.id, {
      balance_paid: sdr.netPaise,
      ...(trip.billed ? { stage: 'CLOSED' } : {}),
    });
    await this.auditService.record(trx, actor, {
      action: 'PAYMENT',
      entityType: 'payments',
      entityId: payment.id,
      after: {
        kind: 'BALANCE',
        tripId: trip.id,
        gross,
        penalty,
        sdrDeduction: sdr.totalPaise,
        carriedForward: sdr.carriedForwardPaise,
      },
    });

    return { payment: this.paymentDto(payment), indentId: trip.indent_id };
  }

  // ---- Transporter bills --------------------------------------------

  async listBills(status?: string) {
    return this.paymentsRepository.listBills(status);
  }

  async getBill(id: string) {
    const bill = await this.paymentsRepository.findBillById(id);
    if (!bill) throw new DomainException(404, 'NOT_FOUND', `Unknown bill: ${id}`);
    return bill;
  }

  /**
   * Accepting a bill IS releasing the balance for its trip (docs/api/06-
   * payments.md: "accept releases at the computed figure" / "accept with
   * atTheirFigure releases at their figure") — not merely a status flip. See
   * `releaseBalanceForTrip` for the shared release logic this now calls.
   */
  async acceptBill(id: string, dto: AcceptBillDto, idempotencyKey: string, actor: AuthenticatedUser) {
    if (dto.atTheirFigure && !dto.reason) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'A reason is required to accept at the transporter\'s figure.');
    }
    this.assertPaymentFields(dto);

    let indentId: string | null = null;
    const result = await this.paymentsRepository.transaction().execute(async (trx) => {
      const existing = await this.paymentsRepository.findByIdempotencyKeyForUpdate(trx, idempotencyKey);
      if (existing) return { id, status: 'ACCEPTED' as const, payment: this.paymentDto(existing) };

      const bill = await this.paymentsRepository.findBillForUpdate(trx, id);
      if (!bill) throw new DomainException(404, 'NOT_FOUND', `Unknown bill: ${id}`);
      if (bill.status !== 'SUBMITTED') {
        throw new DomainException(409, 'BILL_NOT_SUBMITTED', `Bill ${id} is ${bill.status.toLowerCase()}, not submitted.`);
      }

      const trip = await this.paymentsRepository.findTripForUpdate(trx, bill.trip_id);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Bill ${id} has no trip.`);

      const billableOverride = dto.atTheirFigure ? bill.total : null;
      const outcome = await this.releaseBalanceForTrip(trx, trip, billableOverride, dto, idempotencyKey, actor);
      indentId = outcome.indentId;

      const row = await this.paymentsRepository.updateBill(trx, id, { status: 'ACCEPTED' });
      // BR-40: finance owns the released number outright — accepting at the
      // transporter's own figure raises no approval.
      await this.auditService.record(trx, actor, {
        action: 'PAYMENT',
        entityType: 'vendor_bills',
        entityId: id,
        after: { status: 'ACCEPTED', atTheirFigure: Boolean(dto.atTheirFigure), reason: dto.reason },
      });
      return { id: row.id, status: row.status, payment: outcome.payment };
    });
    await this.syncOrder(indentId, actor);
    return result;
  }

  /**
   * The desk raises a transporter's bill for them.
   *
   * The Bills screen could only read and decide bills the transporter had sent
   * from their portal, so a bill handed over on paper — most of them — had no
   * way in. Same rules as the portal's own submit: only once the proof of
   * delivery is approved, one live bill per trip, bill numbers unique per
   * transporter, and a figure above our computed balance is flagged for
   * review, never refused (BR-53).
   */
  async raiseBill(dto: RaiseBillDto, actor: AuthenticatedUser) {
    assertAnyPermission(actor, ['payment.release', 'indent.manage']);
    const billNo = dto.billNo.trim();
    if (dto.billDate.slice(0, 10) > new Date().toISOString().slice(0, 10)) {
      throw new DomainException(400, 'BILL_DATE_FUTURE', 'The bill date cannot be in the future.');
    }

    // The computed balance the bill is measured against — the same figure the
    // balance gate shows, so the variance on the bill and the gate agree.
    const gate = await this.balanceGate(dto.tripId);
    const computedBalancePaise = gate.breakdown.netPaise;

    const id = await this.paymentsRepository.transaction().execute(async (trx) => {
      const trip = await this.paymentsRepository.findTripForUpdate(trx, dto.tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${dto.tripId}`);
      if (trip.pod_status !== 'APPROVED' && trip.pod_closure_basis !== 'WAIVED') {
        throw new DomainException(409, 'POD_NOT_APPROVED', 'A bill can be raised once the proof of delivery is approved.');
      }
      const live = await trx
        .selectFrom('vendor_bills')
        .select(['bill_no'])
        .where('trip_id', '=', trip.id)
        .where('status', 'in', ['SUBMITTED', 'ACCEPTED'])
        .executeTakeFirst();
      if (live) {
        throw new DomainException(409, 'BILL_EXISTS', `This trip already has bill ${live.bill_no}. Decide that one first.`);
      }
      const clash = await trx
        .selectFrom('vendor_bills')
        .select('id')
        .where('vendor_id', '=', trip.vendor_id)
        .where('bill_no', '=', billNo)
        .executeTakeFirst();
      if (clash) {
        throw new DomainException(409, 'BILL_NO_DUPLICATE', `This transporter already has a bill numbered ${billNo}.`);
      }

      const chargeCost = await this.paymentsRepository.chargeCostTotal(trip.id);
      const total = dto.totalPaise ?? computedBalancePaise;
      const bill = await trx
        .insertInto('vendor_bills')
        .values({
          trip_id: trip.id,
          vendor_id: trip.vendor_id,
          bill_no: billNo,
          bill_date: dto.billDate.slice(0, 10),
          attachment_id: dto.attachmentId ?? null,
          freight: trip.buy_rate,
          charges: Number(chargeCost.total),
          total,
          computed_balance: computedBalancePaise,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.auditService.record(trx, actor, {
        action: 'PAYMENT',
        entityType: 'vendor_bills',
        entityId: bill.id,
        after: { raisedBy: 'DESK', tripId: trip.id, billNo, total, computedBalancePaise },
      });
      return bill.id;
    });
    return this.getBill(id);
  }

  async queryBill(id: string, note: string, actor: AuthenticatedUser) {
    return this.paymentsRepository.transaction().execute(async (trx) => {
      const bill = await this.paymentsRepository.findBillForUpdate(trx, id);
      if (!bill) throw new DomainException(404, 'NOT_FOUND', `Unknown bill: ${id}`);
      if (bill.status !== 'SUBMITTED') {
        throw new DomainException(409, 'BILL_NOT_SUBMITTED', `Bill ${id} is ${bill.status.toLowerCase()}, not submitted.`);
      }
      const row = await this.paymentsRepository.updateBill(trx, id, { status: 'QUERIED' });
      await this.auditService.record(trx, actor, {
        action: 'PAYMENT',
        entityType: 'vendor_bills',
        entityId: id,
        after: { status: 'QUERIED', note },
      });
      return { id: row.id, status: row.status };
    });
  }

  // ---- Helpers ------------------------------------------------------

  private assertPaymentFields(dto: ReleasePaymentDto) {
    const missing = (['mode', 'transferType', 'remittingAccount', 'utr', 'valueDate'] as const).filter((k) => !dto[k]);
    if (missing.length > 0) {
      throw new DomainException(400, 'PAYMENT_FIELD_REQUIRED', `Missing required field(s): ${missing.join(', ')}.`);
    }
  }

  private async resolveTripForAdvance(ref: string) {
    const byTrip = await this.paymentsRepository.resolveByTripId(ref);
    if (byTrip) return byTrip;
    const indent = (await this.paymentsRepository.resolveIndentById(ref)) ?? (await this.paymentsRepository.resolveIndentByCode(ref));
    if (!indent) return undefined;
    return this.paymentsRepository.findTripByIndentId(indent.id);
  }

  private async advanceDocumentSet(): Promise<string[]> {
    const config = await this.configRepository.findAll();
    const raw = config.get('advance_document_set');
    return Array.isArray(raw) ? (raw as string[]) : [];
  }

  private async advanceUnmet(tripId: string): Promise<UnmetItem[]> {
    const [docSet, docs] = await Promise.all([this.advanceDocumentSet(), this.paymentsRepository.findDocuments(tripId)]);
    const byKind = new Map(docs.map((d) => [d.kind, d.status]));
    const unmet: UnmetItem[] = [];
    for (const kind of docSet) {
      const status = byKind.get(kind);
      const label = DOC_LABEL[kind] ?? kind;
      if (status === 'VERIFIED') continue;
      if (!status) unmet.push({ key: kind, label: `${label} not uploaded`, state: 'MISSING' });
      else if (status === 'REJECTED') unmet.push({ key: kind, label: `${label} rejected`, state: 'REJECTED' });
      else unmet.push({ key: kind, label: `${label} uploaded but not verified`, state: 'UNVERIFIED' });
    }
    return unmet;
  }

  private async advanceCleared(tripId: string) {
    const [docSet, docs] = await Promise.all([this.advanceDocumentSet(), this.paymentsRepository.findDocuments(tripId)]);
    const byKind = new Map(docs.map((d) => [d.kind, d.status]));
    return docSet
      .filter((kind) => byKind.get(kind) === 'VERIFIED')
      .map((kind) => ({ key: kind, label: DOC_LABEL[kind] ?? kind }));
  }

  /**
   * What would be deducted from a balance payment of `availablePaise` for this
   * transporter's trip. Pass `lock` inside the release transaction so two
   * releases cannot spend the same outstanding amount.
   */
  private async sdrPlan(db: DbExecutor, tripId: string, vendorId: string, availablePaise: number, lock = false) {
    const rows = await this.sdrRepository.outstandingForVendor(db, vendorId, lock);
    const { minPayablePaise } = await this.penaltyLabelConfig();
    return planRecovery(
      rows.map((r) => ({
        id: r.id,
        code: r.code,
        tripId: r.tripId,
        tripCode: r.tripCode,
        outstandingPaise: Number(r.outstandingPaise),
        resolvedAt: String(r.resolvedAt ?? ''),
      })),
      tripId,
      availablePaise,
      minPayablePaise,
    );
  }

  /** The POD condition, plus: an open shortage/damage record holds the balance. */
  private async balanceUnmet(
    tripId: string,
    podStatus: string,
    podClosureBasis: string | null,
    db: DbExecutor = this.paymentsRepository.executor(),
  ): Promise<UnmetItem[]> {
    const unmet = this.balanceUnmetFor(podStatus, podClosureBasis);
    const open = await this.sdrRepository.countOpenForTrip(db, tripId);
    if (open > 0) {
      unmet.push({
        key: 'SDR_OPEN',
        label: `${open} shortage or damage record${open === 1 ? ' is' : 's are'} still open`,
        state: 'BLOCKED',
      });
    }
    return unmet;
  }

  private balanceUnmetFor(podStatus: string, podClosureBasis: string | null): UnmetItem[] {
    if (podStatus === 'APPROVED' || podClosureBasis === 'WAIVED') return [];
    return [{ key: 'POD_STATUS', label: `POD is ${podStatus.toLowerCase()}, not approved`, state: 'BLOCKED' }];
  }

  private async vendorBeneficiary(vendorId: string) {
    const vendor = await this.paymentsRepository.findVendorById(vendorId);
    return {
      name: vendor.legal_name,
      beneficiary: {
        accountHolder: vendor.account_holder,
        account: vendor.bank_account ? `••${vendor.bank_account.slice(-4)}` : null,
        ifsc: vendor.ifsc,
      },
    };
  }

  private async penaltyLabelConfig() {
    const config = await this.configRepository.findAll();
    return {
      perDayPaise: Number(config.get('pod_penalty_per_day_paise') ?? 10000),
      forfeitDays: Number(config.get('pod_forfeit_days') ?? 40),
      // A balance payment is never reduced to nothing: this much is always paid,
      // and it is kept below one hundred rupees.
      minPayablePaise: Math.min(9_900, Math.max(0, Number(config.get('min_balance_payable_paise') ?? 5_000))),
    };
  }

  private daysBetween(a: string, b: string): number {
    return Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));
  }

  private paymentDto(row: {
    id: string;
    trip_id: string | null;
    kind: string;
    gross: number;
    penalty: number;
    net: number;
    utr: string;
    released_by: string;
    released_at: string;
  }) {
    return {
      id: row.id,
      tripId: row.trip_id,
      kind: row.kind,
      grossPaise: row.gross,
      penaltyPaise: row.penalty,
      netPaise: row.net,
      tdsPaise: 0,
      releasedBy: row.released_by,
      releasedAt: row.released_at,
      utr: row.utr,
    };
  }
}
