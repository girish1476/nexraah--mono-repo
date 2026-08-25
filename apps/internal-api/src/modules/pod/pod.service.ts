import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { ApprovalRequiredResponse } from '../../common/approval-required.response';
import { computePenalty, effectivePenalty, type PenaltyConfig } from '../../common/pod-penalty';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalsRegistry } from '../approvals/approvals.registry';
import { ConfigRepository } from '../config/config.repository';
import { OrdersService } from '../orders/orders.service';
import { PodRepository } from './pod.repository';
import type { ReceivePodDto } from './dto/receive-pod.dto';
import type { VerifyPodDto } from './dto/verify-pod.dto';

interface PenaltyWaiverAction {
  tripId: string;
}

@Injectable()
export class PodService implements OnModuleInit {
  constructor(
    private readonly podRepository: PodRepository,
    private readonly configRepository: ConfigRepository,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
    private readonly approvalsService: ApprovalsService,
    private readonly approvalsRegistry: ApprovalsRegistry,
    private readonly ordersService: OrdersService,
  ) {}

  private readonly logger = new Logger('PodService');

  /**
   * Moves the ten-step order ladder after a POD transition has COMMITTED.
   * See `TripsService.syncOrder` for why this must not run inside the
   * transaction, and why a failure here is logged rather than thrown.
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

  onModuleInit() {
    // BR-43: never waived at the desk — only this replay, fired by LEADERSHIP
    // approving, actually zeroes the penalty (via pod_closure_basis).
    this.approvalsRegistry.register('PENALTY_WAIVER', 'trips', async (action: PenaltyWaiverAction, ctx) => {
      // ctx.db is ApprovalsService.approve()'s own transaction — see the
      // deadlock/atomicity note on ApprovalHandler (approvals.types.ts).
      await this.podRepository.updateTrip(ctx.db, action.tripId, { pod_closure_basis: 'WAIVED' });
      await this.auditService.record(ctx.db, { userId: ctx.approverId, role: ctx.approverRole }, {
        action: 'STATUS_CHANGE',
        entityType: 'trips',
        entityId: action.tripId,
        after: { podClosureBasis: 'WAIVED' },
      });
    });
  }

  async receiving(branchId?: string) {
    const [stats, rows, config] = await Promise.all([
      this.podRepository.receivingStats(branchId),
      this.podRepository.receiving(branchId),
      this.penaltyConfig(),
    ]);

    let receivedToday = 0;
    let pastTwentyDays = 0;
    const today = new Date().toDateString();
    const mappedRows = rows.map((r) => {
      const { ageDays } = computePenalty(r.deliveredAt, null, config);
      if (ageDays > config.tatDays) pastTwentyDays += 1;
      if (r.podStatus === 'RECEIVED' && r.deliveredAt && new Date(r.deliveredAt).toDateString() === today) {
        receivedToday += 1;
      }
      return {
        tripId: r.tripId,
        tripCode: r.tripCode,
        lrCode: r.lrCode,
        vendorName: r.vendorName,
        lane: r.lane,
        deliveredAt: r.deliveredAt,
        courierDocket: r.courierDocket,
        attachedAt: null, // Spec 1 owns the portal attach event; not tracked here yet.
        ageDays,
        podStatus: r.podStatus,
        balanceHeldPaise: Math.max(0, r.buyRatePaise - r.advancePaidPaise),
      };
    });

    return {
      stats: {
        attachedInTransit: Number(stats.attachedInTransit),
        receivedToday,
        awaitingVerification: mappedRows.filter((r) => r.podStatus === 'RECEIVED').length,
        awaitingApproval: Number(stats.awaitingApproval),
        balanceHeldPaise: Number(stats.balanceHeldPaise),
        pastTwentyDays,
      },
      rows: mappedRows,
    };
  }

  async receive(tripId: string, dto: ReceivePodDto, actor: AuthenticatedUser) {
    let indentId: string | null = null;
    const receipt = await this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      indentId = trip.indent_id;
      if (!dto.courierDocket) {
        throw new DomainException(400, 'VALIDATION_ERROR', 'courierDocket is required.');
      }

      await this.podRepository.ensureSeriesForBranch(trx, trip.branch_id);
      const code = await this.numberingService.issue(trx, 'POD_RECEIPT', trip.branch_id);

      const receipt = await this.podRepository.insertReceipt(trx, {
        code,
        tripId,
        courierDocket: dto.courierDocket,
        sentOn: dto.sentOn,
        receivedOn: dto.receivedOn,
        pages: dto.pages ?? null,
        receivedBy: dto.receivedBy,
        condition: dto.condition ?? null,
      });

      await this.podRepository.updateTrip(trx, tripId, {
        pod_status: 'RECEIVED',
        pod_received_at: new Date().toISOString(),
      });

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'trips',
        entityId: tripId,
        before: { podStatus: trip.pod_status },
        after: { podStatus: 'RECEIVED', receiptCode: code },
      });

      return {
        id: receipt.id,
        code: receipt.code,
        tripId,
        courierDocket: receipt.courier_docket,
        sentOn: receipt.sent_on,
        receivedOn: receipt.received_on,
        pages: receipt.pages,
        receivedBy: receipt.received_by,
        condition: receipt.condition,
      };
    });
    // Step 8, "POD uploaded".
    await this.syncOrder(indentId, actor);
    return receipt;
  }

  async getById(tripId: string) {
    const trip = await this.podRepository.findTripById(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

    const [receipt, charges, config] = await Promise.all([
      this.podRepository.findReceipt(tripId),
      this.podRepository.findCharges(tripId),
      this.penaltyConfig(),
    ]);

    const { ageDays, penaltyPaise } = effectivePenalty(trip, config);

    return {
      tripId: trip.id,
      tripCode: trip.code,
      deliveredAt: trip.delivered_at,
      podStatus: trip.pod_status,
      podReceivedAt: trip.pod_received_at,
      ageDays,
      penaltyPaise,
      receipt: receipt
        ? {
            code: receipt.code,
            courierDocket: receipt.courier_docket,
            sentOn: receipt.sent_on,
            receivedOn: receipt.received_on,
            condition: receipt.condition,
          }
        : null,
      pages: receipt?.pages ?? null,
      attachmentIds: receipt?.attachment_ids ?? [],
      // BR-50 presentation half: the frontend withholds Approve when this
      // equals the signed-in user's id.
      verifiedBy: receipt?.verified_by ?? null,
      approvedBy: receipt?.approved_by ?? null,
      charges: charges.map((c) => ({
        id: c.id,
        chargeType: c.chargeType,
        costAmountPaise: c.costAmountPaise,
        billedAmountPaise: c.billedAmountPaise,
      })),
    };
  }

  async verify(tripId: string, dto: VerifyPodDto, actor: AuthenticatedUser) {
    const checklistFailed = Object.values(dto.checklist).some((v) => v === false);
    if (checklistFailed && !dto.remarks) {
      throw new DomainException(400, 'REMARKS_REQUIRED', 'Remarks are required when any checklist item fails.');
    }

    let indentId: string | null = null;
    const result = await this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      indentId = trip.indent_id;
      if (trip.pod_status !== 'RECEIVED') {
        throw new DomainException(409, 'NOT_RECEIVED', 'The physical POD must be logged (received) before it can be verified.');
      }

      await this.podRepository.decideReceipt(trx, tripId, {
        verified_by: actor.userId,
        verified_at: new Date().toISOString(),
        checklist: JSON.stringify(dto.checklist),
      });
      await this.podRepository.updateTrip(trx, tripId, { pod_status: 'VERIFIED' });

      // BR-56: charges captured here, landing in trip_charges exactly as
      // POST /trips/:id/charges would.
      for (const charge of dto.charges ?? []) {
        await this.podRepository.insertCharge(trx, {
          tripId,
          chargeType: charge.chargeType,
          costAmountPaise: charge.costAmountPaise,
          billedAmountPaise: charge.billedAmountPaise,
          capturedBy: actor.userId,
        });
      }

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'trips',
        entityId: tripId,
        before: { podStatus: 'RECEIVED' },
        after: { podStatus: 'VERIFIED', remarks: dto.remarks },
      });

      return { tripId, podStatus: 'VERIFIED' };
    });
    // Step 9, "POD verified". Note the ladder stops here until the balance is
    // released — approval is a separate gate the ten steps don't name.
    await this.syncOrder(indentId, actor);
    return result;
  }

  async reject(tripId: string, reason: string, actor: AuthenticatedUser) {
    if (!reason) throw new DomainException(400, 'VALIDATION_ERROR', 'A reason is required to reject a POD.');

    let indentId: string | null = null;
    const result = await this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      indentId = trip.indent_id;

      const receipt = await this.podRepository.findReceiptForUpdate(trx, tripId);
      // BR-52: rejection does not stop the clock — pod_received_at is
      // cleared so the receipt-to-now gap re-enters accrual (flagged as
      // "open for business sign-off" in both spec files: this backdates
      // rather than resuming accrual from the rejection date).
      const nextStatus = receipt ? 'ATTACHED' : 'PENDING';
      await this.podRepository.updateTrip(trx, tripId, { pod_status: nextStatus, pod_received_at: null });
      if (receipt) {
        await this.podRepository.decideReceipt(trx, tripId, {
          reject_reason: reason,
          verified_by: null,
          verified_at: null,
          received_on: null,
        });
      }

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'trips',
        entityId: tripId,
        before: { podStatus: trip.pod_status },
        after: { podStatus: nextStatus, reason },
      });

      return { tripId, podStatus: nextStatus };
    });
    // Rejection moves the ladder BACKWARDS off "POD verified" — correct, and
    // why order_events is append-only rather than a diff of two states.
    await this.syncOrder(indentId, actor, `POD rejected: ${reason}`);
    return result;
  }

  async approve(tripId: string, actor: AuthenticatedUser) {
    let indentId: string | null = null;
    const result = await this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      indentId = trip.indent_id;
      if (trip.pod_status !== 'VERIFIED') {
        throw new DomainException(409, 'NOT_VERIFIED', 'The POD must be verified before it can be approved.');
      }

      const receipt = await this.podRepository.findReceiptForUpdate(trx, tripId);
      // BR-50, layer 2 (the service check). Layer 1 is the DB CHECK
      // constraint on pod_receipts; layer 3 is the button not rendering.
      if (receipt?.verified_by === actor.userId) {
        throw new DomainException(409, 'APPROVER_IS_VERIFIER', 'The verifier cannot approve their own POD.');
      }

      await this.podRepository.decideReceipt(trx, tripId, {
        approved_by: actor.userId,
        approved_at: new Date().toISOString(),
      });
      const updated = await this.podRepository.updateTrip(trx, tripId, {
        pod_status: 'APPROVED',
        pod_closure_basis: 'APPROVED',
      });

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'trips',
        entityId: tripId,
        before: { podStatus: 'VERIFIED' },
        after: { podStatus: 'APPROVED' },
      });

      // BR-10/BR-40: approving unblocks the balance; finance still releases it.
      return { tripId, podStatus: updated.pod_status };
    });
    // Approval keeps the ladder at step 9 — it is what unblocks step 10 rather
    // than a step of its own. Recomputed anyway so `orders` never lags the
    // POD status it derives from.
    await this.syncOrder(indentId, actor);
    return result;
  }

  async pending(filters: { branchId?: string; vendorId?: string; ageing?: string }) {
    const [rows, config] = await Promise.all([this.podRepository.pending(filters), this.penaltyConfig()]);

    const mapped = rows
      .map((r) => {
        const { ageDays, penaltyPaise, forfeited } = effectivePenalty(
          { delivered_at: r.deliveredAt, pod_received_at: r.podReceivedAt, pod_closure_basis: r.podClosureBasis },
          config,
        );
        return {
          tripId: r.tripId,
          tripCode: r.tripCode,
          lrCode: r.lrCode,
          vendorName: r.vendorName,
          clientName: r.clientName,
          lane: r.lane,
          branchName: r.branchName,
          deliveredAt: r.deliveredAt,
          ageDays,
          daysLeft: config.tatDays - ageDays,
          podStatus: r.podStatus,
          penaltyPaise,
          balanceHeldPaise: Math.max(0, r.buyRatePaise - r.advancePaidPaise),
          forfeited,
        };
      })
      .filter((r) => {
        if (filters.ageing === 'within') return !r.forfeited && r.daysLeft >= 0;
        if (filters.ageing === 'breached') return !r.forfeited && r.daysLeft < 0;
        if (filters.ageing === 'forfeited') return r.forfeited;
        return true;
      });

    return {
      stats: {
        pending: mapped.length,
        breached: mapped.filter((r) => !r.forfeited && r.daysLeft < 0).length,
        penaltyAccruedPaise: mapped.reduce((sum, r) => sum + r.penaltyPaise, 0),
        balanceHeldPaise: mapped.reduce((sum, r) => sum + r.balanceHeldPaise, 0),
      },
      rows: mapped,
    };
  }

  async waive(tripId: string, reason: string, actor: AuthenticatedUser): Promise<ApprovalRequiredResponse> {
    if (!reason || reason.length < 30) {
      throw new DomainException(400, 'REASON_TOO_SHORT', 'The waiver reason must be at least 30 characters.');
    }
    const trip = await this.podRepository.findTripById(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

    const action: PenaltyWaiverAction = { tripId };
    return this.approvalsService.raise(
      {
        kind: 'PENALTY_WAIVER',
        entityType: 'trips',
        entityId: tripId,
        reason,
        title: `Penalty waiver · ${trip.code}`,
        detail: 'Compliance proposes waiving the accrued POD penalty.',
        amountPaise: trip.pod_penalty,
        action,
      },
      actor,
    );
  }

  // ---- Penalty --------------------------------------------------------

  private async penaltyConfig(): Promise<PenaltyConfig> {
    const config = await this.configRepository.findAll();
    return {
      tatDays: Number(config.get('pod_tat_days') ?? 20),
      penaltyPerDayPaise: Number(config.get('pod_penalty_per_day_paise') ?? 10000),
      forfeitDays: Number(config.get('pod_forfeit_days') ?? 40),
    };
  }
}
