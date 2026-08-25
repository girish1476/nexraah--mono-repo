import { Injectable, Logger } from '@nestjs/common';
import { DomainException, type UnmetItem } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { ConfigRepository } from '../config/config.repository';
import { OrdersService } from '../orders/orders.service';
import { PaymentsRepository } from './payments.repository';
import type { ReleasePaymentDto } from './dto/release-payment.dto';
import type { AcceptBillDto } from './dto/accept-bill.dto';

const DOC_LABEL: Record<string, string> = {
  CLIENT_INVOICE_OR_PO: 'Client invoice or purchase order',
  EWAY_BILL: 'E-way bill',
  RC: 'Registration certificate',
  INSURANCE: 'Goods insurance',
  FITNESS: 'Fitness certificate',
  PERMIT: 'Permit',
  PUC: 'Pollution certificate',
  DRIVING_LICENCE: 'Driving licence',
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly configRepository: ConfigRepository,
    private readonly auditService: AuditService,
    private readonly ordersService: OrdersService,
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
        const podAgeDays = r.podReceivedAt ? this.daysBetween(r.podReceivedAt, new Date().toISOString()) : null;
        const unmet = this.balanceUnmetFor(r.podStatus, r.podClosureBasis);
        return {
          tripId: r.tripId,
          tripCode: r.tripCode,
          vendorName: r.vendorName,
          lane: r.lane,
          branchName: r.branchName,
          podStatus: r.podStatus,
          podAgeDays,
          netPaise: gross - penalty,
          penaltyPaise: penalty,
          blocked: unmet.length > 0 || r.balancePaid > 0,
          unmetCount: unmet.length,
        };
      }),
    );
  }

  async balanceGate(tripId: string) {
    const trip = await this.paymentsRepository.resolveByTripId(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

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

    const unmet = this.balanceUnmetFor(trip.pod_status, trip.pod_closure_basis);

    return {
      tripId: trip.id,
      tripCode: trip.code,
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
        grossPaise,
        netPaise: grossPaise - penaltyPaise,
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
      if (trip.balance_paid > 0) {
        throw new DomainException(409, 'BALANCE_ALREADY_RELEASED', 'The balance has already been released for this trip.');
      }

      const penaltyConfig = await this.penaltyLabelConfig();
      const ageDays = trip.pod_received_at ? this.daysBetween(trip.pod_received_at, new Date().toISOString()) : 0;
      // BR-25: past 40 days, nothing is payable — the trip closes.
      if (ageDays > penaltyConfig.forfeitDays && trip.pod_closure_basis !== 'WAIVED') {
        await this.paymentsRepository.updateTrip(trx, tripId, {
          pod_status: 'FORFEITED',
          pod_closure_basis: 'FORFEITED',
          stage: 'CLOSED',
        });
        await this.auditService.record(trx, actor, {
          action: 'STATUS_CHANGE',
          entityType: 'trips',
          entityId: tripId,
          after: { podStatus: 'FORFEITED', stage: 'CLOSED' },
        });
        throw new DomainException(409, 'POD_FORFEITED', 'This POD is past the forfeiture window; nothing is payable.');
      }

      const unmet = this.balanceUnmetFor(trip.pod_status, trip.pod_closure_basis);
      if (unmet.length > 0) {
        throw new DomainException(409, 'BALANCE_BLOCKED', 'The balance is blocked.', { unmet });
      }

      indentId = trip.indent_id;

      const chargeCost = await this.paymentsRepository.chargeCostTotal(tripId);
      const billable = trip.buy_rate + Number(chargeCost.total);
      const gross = billable - trip.advance_paid;
      const penalty = trip.pod_closure_basis === 'WAIVED' ? 0 : trip.pod_penalty;

      const payment = await this.paymentsRepository.insertPayment(trx, {
        tripId: trip.id,
        indentId: null,
        kind: 'BALANCE',
        gross,
        penalty,
        mode: dto.mode,
        transferType: dto.transferType,
        remittingAccount: dto.remittingAccount,
        utr: dto.utr,
        valueDate: dto.valueDate,
        releasedBy: actor.userId,
        idempotencyKey,
      });

      await this.paymentsRepository.updateTrip(trx, tripId, {
        balance_paid: gross - penalty,
        billed: true,
        stage: 'CLOSED',
      });
      await this.auditService.record(trx, actor, {
        action: 'PAYMENT',
        entityType: 'payments',
        entityId: payment.id,
        after: { kind: 'BALANCE', tripId, gross, penalty },
      });

      return this.paymentDto(payment);
    });
    // Step 10, "Balance released" — the last rung. `recompute` stamps
    // `closed_at` when it lands here, which is what makes an order "settled".
    await this.syncOrder(indentId, actor);
    return result;
  }

  // ---- Transporter bills --------------------------------------------

  async listBills(status?: string) {
    return this.paymentsRepository.listBills(status);
  }

  async acceptBill(id: string, dto: AcceptBillDto, actor: AuthenticatedUser) {
    if (dto.atTheirFigure && !dto.reason) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'A reason is required to accept at the transporter\'s figure.');
    }
    return this.paymentsRepository.transaction().execute(async (trx) => {
      const bill = await this.paymentsRepository.findBillForUpdate(trx, id);
      if (!bill) throw new DomainException(404, 'NOT_FOUND', `Unknown bill: ${id}`);

      const row = await this.paymentsRepository.updateBill(trx, id, { status: 'ACCEPTED' });
      // BR-40: finance owns the released number outright — accepting at the
      // transporter's own figure raises no approval.
      await this.auditService.record(trx, actor, {
        action: 'PAYMENT',
        entityType: 'vendor_bills',
        entityId: id,
        after: { status: 'ACCEPTED', atTheirFigure: Boolean(dto.atTheirFigure), reason: dto.reason },
      });
      return { id: row.id, status: row.status };
    });
  }

  async queryBill(id: string, note: string, actor: AuthenticatedUser) {
    return this.paymentsRepository.transaction().execute(async (trx) => {
      const bill = await this.paymentsRepository.findBillForUpdate(trx, id);
      if (!bill) throw new DomainException(404, 'NOT_FOUND', `Unknown bill: ${id}`);
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
