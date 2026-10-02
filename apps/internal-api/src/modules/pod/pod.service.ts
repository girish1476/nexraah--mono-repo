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
import type { AddDocketDto } from './dto/add-docket.dto';
import type { WaivePenaltyDto } from './dto/waive-pod.dto';
import type { ReceivePodDto } from './dto/receive-pod.dto';
import type { VerifyPodDto } from './dto/verify-pod.dto';
import type { UploadEpodDto } from './dto/upload-epod.dto';
import type { HardCopyDto } from './dto/hard-copy.dto';
import { SdrRepository } from '../sdr/sdr.repository';
import type { SdrKind } from '../sdr/dto/sdr.dto';

/**
 * Which kind of SDR a verified proof calls for, if any. A failed "no shortage
 * or damage" check, or a quantity that does not match the invoice, is one;
 * the verifier's own choice of kind wins, else a quantity mismatch reads as a
 * shortage and anything else as damage.
 */
export function sdrKindFromChecklist(dto: Pick<VerifyPodDto, 'checklist' | 'sdrKind'>): SdrKind | null {
  const shortOrDamaged = dto.checklist.noShortageOrDamage === false;
  const quantityOff = dto.checklist.quantityMatchesInvoice === false;
  if (!shortOrDamaged && !quantityOff) return null;
  return dto.sdrKind ?? (quantityOff && !shortOrDamaged ? 'SHORTAGE' : 'DAMAGE');
}

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
    private readonly sdrRepository: SdrRepository,
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
    const [stats, rows, config, receivedToday] = await Promise.all([
      this.podRepository.receivingStats(branchId),
      this.podRepository.receiving(branchId),
      this.penaltyConfig(),
      this.podRepository.receivedTodayCount(branchId),
    ]);

    let pastTwentyDays = 0;
    const mappedRows = rows.map((r) => {
      const { ageDays } = computePenalty(r.deliveredAt, null, config);
      if (ageDays > config.tatDays) pastTwentyDays += 1;
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

  /**
   * The courier docket for a delivery, entered by whoever tracks the POD when
   * the transporter has not attached one themselves. It does not move the POD's
   * status — the paper has not arrived, only its courier reference — but it
   * takes the delivery off the hard-copy follow-up list.
   */
  async addDocket(tripId: string, dto: AddDocketDto, actor: AuthenticatedUser) {
    await this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      if (!trip.delivered_at) {
        throw new DomainException(409, 'NOT_DELIVERED', 'A docket can only be recorded once the load has been delivered.');
      }
      if (trip.pod_status === 'APPROVED' || trip.pod_status === 'FORFEITED') {
        throw new DomainException(409, 'POD_CLOSED', 'This delivery proof is already closed.');
      }
      // A docket is optional and can be corrected: entering one again replaces the
      // number on record rather than adding a second.
      const existingDocket = await this.podRepository.findDocket(trx, tripId);
      if (existingDocket) {
        await this.podRepository.updateDocket(
          trx,
          tripId,
          dto.docketNo.trim(),
          dto.sentOn ?? new Date().toISOString().slice(0, 10),
        );
        await this.auditService.record(trx, actor, {
          action: 'POD_DOCKET_CHANGED',
          entityType: 'trips',
          entityId: tripId,
          before: { docketNo: existingDocket.docketNo },
          after: { docketNo: dto.docketNo.trim() },
        });
        return;
      }
      await this.podRepository.ensureSeriesForBranch(trx, trip.branch_id);
      const code = await this.numberingService.issue(trx, 'POD_RECEIPT', trip.branch_id);
      await this.podRepository.insertDocketOnly(trx, {
        code,
        tripId,
        docketNo: dto.docketNo.trim(),
        sentOn: dto.sentOn ?? new Date().toISOString().slice(0, 10),
        note: `Docket added by ${actor.name}`,
      });
      await this.auditService.record(trx, actor, {
        action: 'POD_DOCKET_ADDED',
        entityType: 'trips',
        entityId: tripId,
        after: { docketNo: dto.docketNo.trim() },
      });
    });
    return { tripId, docketNo: dto.docketNo.trim() };
  }

  async receive(tripId: string, dto: ReceivePodDto, actor: AuthenticatedUser) {
    let indentId: string | null = null;
    const receipt = await this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      indentId = trip.indent_id;
      // The paper can only arrive for a delivery still waiting on it: not before
      // delivery, and not once the proof is approved or written off.
      if (!trip.delivered_at) {
        throw new DomainException(409, 'NOT_DELIVERED', 'A delivery proof can only be received once the load has been delivered.');
      }
      if (!['PENDING', 'ATTACHED', 'REJECTED'].includes(trip.pod_status)) {
        throw new DomainException(409, 'POD_NOT_AWAITED', `This delivery proof is ${trip.pod_status.toLowerCase()}; there is nothing left to receive.`);
      }
      // The H-POD is the scan of the signed hard copy. A bare docket with no
      // scan is still accepted from older callers, but the scan is the norm.
      const attachmentIds = dto.attachmentIds ?? [];
      const docket = dto.courierDocket?.trim() || null;
      if (attachmentIds.length === 0 && !docket) {
        throw new DomainException(400, 'VALIDATION_ERROR', 'Upload the scan of the signed hard copy.');
      }
      const today = new Date().toISOString().slice(0, 10);
      // BR-51 (`pod_attach_needs_docket`): docket and sent-on together, or neither.
      const sentOn = docket ? (dto.sentOn || today) : null;

      await this.podRepository.ensureSeriesForBranch(trx, trip.branch_id);
      const code = await this.numberingService.issue(trx, 'POD_RECEIPT', trip.branch_id);

      const receipt = await this.podRepository.insertReceipt(trx, {
        code,
        tripId,
        courierDocket: docket,
        sentOn,
        receivedOn: dto.receivedOn || today,
        pages: dto.pages ?? (attachmentIds.length || null),
        receivedBy: dto.receivedBy ?? actor.name,
        condition: dto.condition ?? null,
        courierSlipAttachmentId: dto.courierSlipAttachmentId ?? null,
        attachmentIds,
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

  /**
   * E-POD: the proof of delivery as a photo or scan, uploaded from the desk.
   * The other way in is H-POD — the signed hard copy by courier (`receive`).
   * Either one stops the clock and opens verification; an E-POD needs no
   * courier docket because nothing was couriered.
   */
  async uploadEpod(tripId: string, dto: UploadEpodDto, actor: AuthenticatedUser) {
    let indentId: string | null = null;
    const receipt = await this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      indentId = trip.indent_id;
      if (!trip.delivered_at) {
        throw new DomainException(409, 'NOT_DELIVERED', 'The proof of delivery is uploaded once the truck is unloaded.');
      }
      if (!['PENDING', 'ATTACHED', 'REJECTED'].includes(trip.pod_status)) {
        throw new DomainException(409, 'POD_NOT_AWAITED', `This delivery proof is ${trip.pod_status.toLowerCase()}; there is nothing left to receive.`);
      }
      await this.podRepository.ensureSeriesForBranch(trx, trip.branch_id);
      const code = await this.numberingService.issue(trx, 'POD_RECEIPT', trip.branch_id);
      const today = new Date().toISOString().slice(0, 10);
      const hardCopyDocket = dto.hardCopyDocket?.trim() || null;
      const row = await this.podRepository.insertEpod(trx, {
        code,
        tripId,
        attachmentIds: dto.attachmentIds,
        receivedOn: today,
        pages: dto.attachmentIds.length,
        receivedBy: actor.name,
        hardCopyDocket,
        hardCopySentOn: hardCopyDocket ? (dto.hardCopySentOn ?? today) : null,
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
        after: { podStatus: 'RECEIVED', podKind: 'EPOD', receiptCode: code, note: dto.note ?? null },
      });
      return { id: row.id, code: row.code, tripId, podKind: 'EPOD', attachmentIds: dto.attachmentIds, receivedOn: today };
    });
    // Step 8, "POD uploaded".
    await this.syncOrder(indentId, actor);
    return receipt;
  }

  /**
   * The hard copy (H-POD) behind an E-POD. The E-POD already stopped the clock
   * and lets the proof be verified and approved — but the balance is held
   * until the hard copy is uploaded here and then checked (`verifyHardCopy`).
   * Its courier docket can be recorded first, while it is still on the way.
   */
  async logHardCopy(tripId: string, dto: HardCopyDto, actor: AuthenticatedUser) {
    return this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      const receipt = await this.podRepository.findReceiptForUpdate(trx, tripId);
      if (!receipt || receipt.pod_kind !== 'EPOD') {
        throw new DomainException(409, 'NO_EPOD', 'The hard copy is followed up after an E-POD. Upload the E-POD first, or upload the H-POD directly.');
      }
      const attachmentIds = dto.attachmentIds ?? [];
      const docket = dto.courierDocket?.trim() || null;
      if (attachmentIds.length === 0 && !docket) {
        throw new DomainException(400, 'VALIDATION_ERROR', 'Upload the scan of the hard copy, or enter its courier docket.');
      }
      const today = new Date().toISOString().slice(0, 10);
      const sentOn = dto.sentOn ?? (docket ? (receipt.hard_copy_sent_on ?? today) : undefined);
      const receivedOn = attachmentIds.length > 0 ? (dto.receivedOn ?? today) : dto.receivedOn;
      if (receivedOn && sentOn && receivedOn < sentOn) {
        throw new DomainException(400, 'VALIDATION_ERROR', 'The hard copy cannot reach head office before it was sent.');
      }
      const row = await this.podRepository.updateHardCopy(trx, receipt.id, {
        ...(docket ? { hard_copy_docket: docket } : {}),
        ...(sentOn ? { hard_copy_sent_on: sentOn } : {}),
        ...(receivedOn ? { hard_copy_received_on: receivedOn } : {}),
        ...(dto.courierSlipAttachmentId ? { courier_slip_attachment_id: dto.courierSlipAttachmentId } : {}),
        // A new scan replaces the old one and needs checking again.
        ...(attachmentIds.length > 0
          ? { hard_copy_attachment_ids: attachmentIds, hard_copy_verified_at: null, hard_copy_verified_by: null }
          : {}),
      });
      await this.auditService.record(trx, actor, {
        action: attachmentIds.length > 0 ? 'POD_HARD_COPY_UPLOADED' : 'POD_HARD_COPY_SENT',
        entityType: 'trips',
        entityId: tripId,
        after: { docket, sentOn: sentOn ?? null, receivedOn: receivedOn ?? null, pages: attachmentIds.length },
      });
      return {
        tripId,
        courierDocket: row.hard_copy_docket,
        sentOn: row.hard_copy_sent_on,
        receivedOn: row.hard_copy_received_on,
        courierSlipAttachmentId: row.courier_slip_attachment_id,
        attachmentIds: row.hard_copy_attachment_ids,
        verifiedAt: row.hard_copy_verified_at,
      };
    });
  }

  /**
   * The check on the hard copy behind an E-POD — the last thing the balance
   * waits for. Only an uploaded scan can be verified.
   */
  async verifyHardCopy(tripId: string, actor: AuthenticatedUser) {
    return this.podRepository.transaction().execute(async (trx) => {
      const receipt = await this.podRepository.findReceiptForUpdate(trx, tripId);
      if (!receipt || receipt.pod_kind !== 'EPOD') {
        throw new DomainException(409, 'NO_EPOD', 'There is no E-POD on this trip, so no separate hard copy to verify.');
      }
      if ((receipt.hard_copy_attachment_ids ?? []).length === 0) {
        throw new DomainException(409, 'HARD_COPY_NOT_UPLOADED', 'Upload the scan of the hard copy before verifying it.');
      }
      if (receipt.hard_copy_verified_at) {
        throw new DomainException(409, 'HARD_COPY_ALREADY_VERIFIED', 'The hard copy is already verified.');
      }
      const now = new Date().toISOString();
      await this.podRepository.updateHardCopy(trx, receipt.id, {
        hard_copy_verified_at: now,
        hard_copy_verified_by: actor.userId,
      });
      await this.auditService.record(trx, actor, {
        action: 'POD_HARD_COPY_VERIFIED',
        entityType: 'trips',
        entityId: tripId,
        after: { verifiedAt: now },
      });
      return { tripId, verifiedAt: now, verifiedBy: actor.name };
    });
  }

  async getById(tripId: string) {
    const trip = await this.podRepository.findTripDetailById(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

    const [receipt, charges, config] = await Promise.all([
      this.podRepository.findReceipt(tripId),
      this.podRepository.findCharges(tripId),
      this.penaltyConfig(),
    ]);

    const { ageDays, penaltyPaise } = effectivePenalty(
      { delivered_at: trip.deliveredAt, pod_received_at: trip.podReceivedAt, pod_closure_basis: trip.podClosureBasis },
      config,
    );

    return {
      tripId: trip.id,
      tripCode: trip.code,
      indentCode: trip.indentCode,
      lrCode: trip.lrCode,
      vendorName: trip.vendorName,
      clientName: trip.clientName,
      lane: trip.lane,
      deliveredAt: trip.deliveredAt,
      podStatus: trip.podStatus,
      podReceivedAt: trip.podReceivedAt,
      ageDays,
      penaltyPaise,
      receipt: receipt
        ? {
            id: receipt.id,
            code: receipt.code,
            tripId: receipt.trip_id,
            courierDocket: receipt.courier_docket,
            sentOn: receipt.sent_on,
            receivedOn: receipt.received_on,
            pages: receipt.pages,
            receivedBy: receipt.received_by,
            condition: receipt.condition,
            podKind: receipt.pod_kind,
          }
        : null,
      podKind: receipt?.pod_kind ?? null,
      // The hard copy followed up after an E-POD (or the courier slip of an H-POD).
      hardCopy: receipt
        ? {
            courierDocket: receipt.pod_kind === 'EPOD' ? receipt.hard_copy_docket : receipt.courier_docket,
            sentOn: receipt.pod_kind === 'EPOD' ? receipt.hard_copy_sent_on : receipt.sent_on,
            receivedOn: receipt.pod_kind === 'EPOD' ? receipt.hard_copy_received_on : receipt.received_on,
            courierSlipAttachmentId: receipt.courier_slip_attachment_id,
            // E-POD only: the scanned hard copy and its check, which the balance waits for.
            attachmentIds: receipt.pod_kind === 'EPOD' ? (receipt.hard_copy_attachment_ids ?? []) : receipt.attachment_ids ?? [],
            verifiedAt: receipt.pod_kind === 'EPOD' ? receipt.hard_copy_verified_at : receipt.verified_at,
          }
        : null,
      // True while an E-POD's hard copy has not been uploaded and verified — the balance is held.
      hardCopyHoldsBalance:
        receipt?.pod_kind === 'EPOD' && !receipt.hard_copy_verified_at,
      // The POD check covers shortage, damage and the transit penalty.
      transitPenaltyPaise: trip.transitPenaltyWaived ? 0 : Number(trip.transitPenalty ?? 0),
      actualTransitDays: trip.actualTransitDays ?? null,
      transitDaysRequired: trip.transitDaysRequired ?? null,
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

      /*
       * The proof says something arrived short or damaged: that is an SDR.
       *
       * The verifier used to tick "shortage or damage noted", write it in the
       * remarks — and then have to go to the SDR screen and type the same
       * thing again, or more often not, so the balance was paid in full on a
       * damaged load. The remarks are now the SDR, raised in the same
       * transaction, which also holds the balance until it is resolved.
       */
      const sdrKind = sdrKindFromChecklist(dto);
      let sdrCode: string | null = null;
      if (sdrKind) {
        sdrCode = await this.numberingService.issue(trx, 'SDR');
        await this.sdrRepository.insert(trx, {
          code: sdrCode,
          tripId,
          vendorId: trip.vendor_id,
          kind: sdrKind,
          description: (dto.remarks ?? '').trim(),
          claimedPaise: dto.sdrClaimedAmountPaise ?? 0,
          raisedBy: actor.userId,
        });
        await this.auditService.record(trx, actor, {
          action: 'SDR_RAISED',
          entityType: 'trips',
          entityId: tripId,
          after: { sdr: sdrCode, kind: sdrKind, claimedAmountPaise: dto.sdrClaimedAmountPaise ?? 0, from: 'POD_REMARKS' },
        });
      }

      return { tripId, podStatus: 'VERIFIED', sdrCode };
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
      // Mirrors verify()'s NOT_RECEIVED and approve()'s NOT_VERIFIED guards —
      // without this, an already APPROVED/WAIVED trip could be reopened via
      // a direct API call, reverting pod_status while leaving approved_by/
      // approved_at populated inconsistently.
      if (!['RECEIVED', 'VERIFIED'].includes(trip.pod_status)) {
        throw new DomainException(
          409,
          'NOT_REJECTABLE',
          'The POD must be received or verified before it can be rejected.',
        );
      }
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
          approved_by: null,
          approved_at: null,
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
          // Once a docket is on record the paper is on its way and the delivery
          // drops out of the follow-up ("hard copy pending") list.
          docketNo: r.docketNo ?? null,
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

  /**
   * Waives a penalty on Leadership's say-so. Leadership agrees it by mail;
   * Compliance (`pod.waive`) records it here with the mail's subject as the
   * evidence, and it takes effect at once. Covers the paperwork (POD) penalty and
   * the late-delivery (transit) penalty; what is still owed on an SDR is waived
   * from the SDR itself.
   */
  async waive(tripId: string, dto: WaivePenaltyDto, actor: AuthenticatedUser) {
    const result = await this.podRepository.transaction().execute(async (trx) => {
      const trip = await this.podRepository.findTripForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

      let amount = 0;
      if (dto.kind === 'POD_PENALTY') {
        if (trip.pod_closure_basis === 'WAIVED') {
          throw new DomainException(409, 'ALREADY_WAIVED', 'The delivery-proof penalty is already waived for this trip.');
        }
        amount = Number(trip.pod_penalty);
        await this.podRepository.updateTrip(trx, tripId, { pod_closure_basis: 'WAIVED' });
      } else {
        if (trip.transit_penalty_waived || Number(trip.transit_penalty) <= 0) {
          throw new DomainException(409, 'NOTHING_TO_WAIVE', 'There is no late-delivery penalty left to waive on this trip.');
        }
        amount = Number(trip.transit_penalty);
        await this.podRepository.updateTrip(trx, tripId, { transit_penalty: 0, transit_penalty_waived: true });
      }

      await this.podRepository.insertWaiver(trx, {
        kind: dto.kind,
        tripId,
        amount,
        mailSubject: dto.mailSubject.trim(),
        mailAttachmentId: dto.mailAttachmentId ?? null,
        note: dto.note?.trim() || null,
        waivedBy: actor.userId,
      });
      await this.auditService.record(trx, actor, {
        action: 'PENALTY_WAIVED',
        entityType: 'trips',
        entityId: tripId,
        after: { kind: dto.kind, amountPaise: amount, mail: dto.mailSubject.trim() },
      });
      return { tripId, kind: dto.kind, waivedPaise: amount };
    });
    return result;
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
