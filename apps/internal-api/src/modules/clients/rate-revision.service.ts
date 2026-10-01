import { Injectable, OnModuleInit } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { ApprovalRequiredResponse } from '../../common/approval-required.response';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalsRegistry } from '../approvals/approvals.registry';
import { ClientsRepository } from './clients.repository';
import { ProposeRateRevisionDto } from './dto/propose-rate-revision.dto';
import { SetLaneBandDto } from './dto/set-lane-band.dto';
import { checkRevision, revisionRows, type LaneForRevision } from './rate-revision';
import { AddRateLaneDto } from './dto/add-rate-lane.dto';
import { checkNewLane, routePart } from './rate-lane';

/** Replayed verbatim on approval. Only the id — everything else is re-read under lock. */
interface RateRevisionAction {
  revisionId: string;
}

/** Replayed on approval: the lane exactly as it was proposed. */
interface RateCardLaneAction {
  clientId: string;
  origin: string;
  destination: string;
  truckType: string;
  ratePaise: number;
  transitDays: number;
  validFrom: string;
  validTo: string | null;
  reason: string;
  transitPenaltyApplies: boolean;
  transitPenaltyPerDayPaise: number;
  approvalMailSubject: string;
  approvalMailAttachmentId: string | null;
  /** FTL (whole truck) or PMT (per metric tonne). Proposals raised before this existed replay as FTL. */
  rateBasis?: RateBasis;
}

export type RateBasis = 'FTL' | 'PMT';

/** Removing a duplicate rate is Leadership's or an administrator's call — nobody else's. */
export const RATE_DELETE_ROLES: readonly string[] = ['LEADERSHIP', 'ADMIN'];

function assertCanDeleteRates(actor: AuthenticatedUser): void {
  if (!RATE_DELETE_ROLES.includes(actor.role)) {
    throw new DomainException(403, 'PERMISSION_DENIED', 'Only Leadership or an administrator can delete a rate.');
  }
}

function assertDeleteReason(reason: string | undefined): string {
  const text = (reason ?? '').trim();
  if (text.length < 10) {
    throw new DomainException(400, 'REASON_TOO_SHORT', 'Say why this rate is being deleted (at least 10 characters).');
  }
  return text;
}

/** "₹2,450 per tonne" or "₹64,200 per truck" — how a lane's rate reads anywhere a person sees it. */
function rateLabel(paise: number, basis: RateBasis | string | undefined): string {
  return `${rupees(paise)} ${basis === 'PMT' ? 'per tonne' : 'per truck'}`;
}

/** Replayed on approval: the lane and the band that was asked for. */
interface LaneBandAction {
  laneId: string;
  bidMinPaise: number;
  bidMaxPaise: number;
}

/**
 * Client rate revision — the rate card's missing write path.
 *
 * `rate_card_lanes` has had exactly one writer since day one: an INSERT from
 * the RFQ award. So a rate could be agreed and then never changed, and a
 * mid-contract revision meant re-running a whole RFQ cycle for a number both
 * sides had already settled on the phone.
 *
 * Two decisions worth stating, because both are load-bearing:
 *
 *  1. **A revision is not an edit.** It closes the lane in force and inserts a
 *     successor. `rate-cross-check.ts` prices an indent against the lane in
 *     force on its *pickup date*, so mutating the row in place would make a
 *     correctly-priced historical indent fail its own check, and would leave a
 *     billing dispute with no record of what was agreed at the time.
 *  2. **It needs a second signature.** Proposing is gated on `rate.revise`
 *     (Finance); applying goes through the approvals engine on
 *     `approve.contract` (Compliance, Leadership). Neither approving desk holds
 *     `rate.revise`, so nobody countersigns their own proposal — asserted in
 *     the portal's `permissions-drift.test.ts`.
 */
@Injectable()
export class RateRevisionService implements OnModuleInit {
  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly approvalsService: ApprovalsService,
    private readonly approvalsRegistry: ApprovalsRegistry,
    private readonly auditService: AuditService,
  ) {}

  onModuleInit() {
    // Runs inside ApprovalsService.approve()'s transaction (ctx.db) — see the
    // note on RATE_REVISION below for why a handler never opens its own.
    this.approvalsRegistry.register('LANE_BAND_CHANGE', 'clients', async (action: LaneBandAction, ctx) => {
      const lane = await this.clientsRepository.findLaneForUpdate(ctx.db, action.laneId);
      if (!lane) {
        throw new DomainException(409, 'LANE_NOT_FOUND', 'The lane this band change was raised against no longer exists.');
      }
      await this.clientsRepository.updateLaneBand(ctx.db, lane.id, {
        bid_min: action.bidMinPaise,
        bid_max: action.bidMaxPaise,
      });
      await this.auditService.record(
        ctx.db,
        { userId: ctx.approverId, role: ctx.approverRole },
        {
          action: 'LANE_BAND_CHANGED',
          entityType: 'rate_card_lanes',
          entityId: lane.id,
          before: { bidMinPaise: lane.bid_min, bidMaxPaise: lane.bid_max },
          after: { bidMinPaise: action.bidMinPaise, bidMaxPaise: action.bidMaxPaise },
        },
      );
    });

    this.approvalsRegistry.register('RATE_CARD_LANE', 'clients', async (action: RateCardLaneAction, ctx) => {
      const client = await ctx.db
        .selectFrom('clients')
        .select(['id', 'code'])
        .where('id', '=', action.clientId)
        .forUpdate()
        .executeTakeFirst();
      if (!client) {
        throw new DomainException(409, 'CLIENT_NOT_FOUND', 'The client this rate was proposed for no longer exists.');
      }

      /*
       * Re-checked here, not only at propose time: the approval can sit in the
       * inbox for days, and a lane for this route may have been won at RFQ or
       * approved from another proposal in between. Refuse the approval rather
       * than leave two rates in force for one route on one day. The client row
       * lock above is what serialises two of these approved together.
       */
      const sameRoute = await this.clientsRepository.findRouteLanes(
        client.id,
        action.origin,
        action.destination,
        action.truckType,
        ctx.db,
      );
      const recheck = checkNewLane(
        action,
        sameRoute.map((l) => ({ id: l.id, validFrom: l.valid_from, validTo: l.valid_to })),
      );
      if (!recheck.ok) {
        throw new DomainException(
          409,
          'RATE_LANE_NO_LONGER_VALID',
          `${recheck.reason} Raise a fresh proposal if it is still wanted.`,
        );
      }

      const rfqLane = await this.clientsRepository.syntheticRfqLane(ctx.db, client.id, action, `DIRECT/${client.code}`);
      const lane = await this.clientsRepository.insertLane(ctx.db, {
        client_id: client.id,
        rfq_lane_id: rfqLane.id,
        origin: action.origin,
        destination: action.destination,
        truck_type: action.truckType,
        rate: action.ratePaise,
        transit_days: action.transitDays,
        reporting_rule: null,
        valid_from: action.validFrom,
        valid_to: action.validTo,
        supply_source: null,
        supply_remarks: null,
        transit_penalty_applies: action.transitPenaltyApplies,
        transit_penalty_per_day: action.transitPenaltyApplies ? action.transitPenaltyPerDayPaise : 0,
        approval_mail_subject: action.approvalMailSubject,
        approval_mail_attachment_id: action.approvalMailAttachmentId,
        rate_basis: action.rateBasis ?? 'FTL',
      });

      await this.auditService.record(
        ctx.db,
        { userId: ctx.approverId, role: ctx.approverRole },
        {
          action: 'RATE_LANE_ADDED',
          entityType: 'rate_card_lanes',
          entityId: lane.id,
          before: null,
          after: {
            laneId: lane.id,
            route: `${action.origin} → ${action.destination}`,
            truckType: action.truckType,
            rate: action.ratePaise,
            rateBasis: action.rateBasis ?? 'FTL',
            transitDays: action.transitDays,
            transitPenaltyApplies: action.transitPenaltyApplies,
            transitPenaltyPerDayPaise: action.transitPenaltyApplies ? action.transitPenaltyPerDayPaise : 0,
            validFrom: action.validFrom,
            approvalMail: action.approvalMailSubject,
            source: action.reason,
          },
        },
      );
    });

    this.approvalsRegistry.register('RATE_REVISION', 'clients', async (action: RateRevisionAction, ctx) => {
      /*
       * Runs inside ApprovalsService.approve()'s transaction (ctx.db), never a
       * second one — approve() holds the `approvals` row FOR UPDATE for the
       * whole call and `rate_revisions.approval_id` references it, so a
       * handler-owned transaction deadlocks against the still-open outer one
       * (approvals.types.ts).
       */
      const revision = await ctx.db
        .selectFrom('rate_revisions')
        .selectAll()
        .where('id', '=', action.revisionId)
        .forUpdate()
        .executeTakeFirst();

      if (!revision) {
        throw new DomainException(409, 'REVISION_NOT_FOUND', 'That rate revision no longer exists.');
      }
      if (revision.status !== 'PENDING') {
        // Not worth swallowing: it means the same approval was replayed, and
        // applying it twice would close the successor lane as well.
        throw new DomainException(409, 'REVISION_ALREADY_DECIDED', 'That rate revision has already been applied.');
      }

      const lane = await this.clientsRepository.findLaneForUpdate(ctx.db, revision.from_lane_id);
      if (!lane) {
        throw new DomainException(409, 'LANE_NOT_FOUND', 'The lane this revision was raised against no longer exists.');
      }

      /*
       * Re-checked here, not only at propose time. An approval can sit in the
       * inbox for days, and an effective date that was in the future when it
       * was raised may be in the past by the time somebody signs it — at which
       * point applying it would re-price loads raised in between. Better to
       * refuse the approval than to backdate quietly.
       */
      const recheck = checkRevision(
        toLane(lane),
        {
          newRatePaise: Number(revision.new_rate),
          effectiveFrom: revision.effective_from,
          reason: revision.reason,
        },
        new Date(),
      );

      if (!recheck.ok) {
        throw new DomainException(
          409,
          'REVISION_NO_LONGER_VALID',
          `${recheck.reason} Raise a fresh revision with a current date.`,
        );
      }

      const rows = revisionRows(toLane(lane), {
        newRatePaise: Number(revision.new_rate),
        effectiveFrom: revision.effective_from,
      });

      await this.clientsRepository.closeLane(ctx.db, lane.id, rows.closeOldTo);

      const successor = await this.clientsRepository.insertLane(ctx.db, {
        client_id: lane.client_id,
        // The successor belongs to the same won lane — keeping `rfq_lane_id`
        // preserves the trail back to the RFQ the rate was originally agreed
        // in, and the column is NOT NULL (BR-37) so it could not be dropped
        // even if that were desirable.
        rfq_lane_id: lane.rfq_lane_id,
        origin: lane.origin,
        destination: lane.destination,
        truck_type: lane.truck_type,
        rate: rows.successor.ratePaise,
        transit_days: lane.transit_days,
        reporting_rule: lane.reporting_rule,
        valid_from: rows.successor.validFrom,
        valid_to: rows.successor.validTo,
        supply_source: lane.supply_source,
        supply_remarks: lane.supply_remarks,
        // A new rate is not a new band: it carries across so a rate update
        // never silently strips the floor and ceiling off the lane.
        bid_min: lane.bid_min,
        bid_max: lane.bid_max,
        transit_penalty_applies: revision.transit_penalty_applies ?? lane.transit_penalty_applies,
        transit_penalty_per_day: Number(revision.transit_penalty_per_day ?? lane.transit_penalty_per_day),
        approval_mail_subject: revision.approval_mail_subject,
        approval_mail_attachment_id: revision.approval_mail_attachment_id,
        // A new price on the same basis: a per-tonne lane stays per tonne.
        rate_basis: lane.rate_basis,
      });

      await this.clientsRepository.updateRevision(ctx.db, revision.id, {
        status: 'APPLIED',
        to_lane_id: successor.id,
        approved_by: ctx.approverId,
      });

      await this.auditService.record(
        ctx.db,
        { userId: ctx.approverId, role: ctx.approverRole },
        {
          action: 'RATE_REVISION_APPLIED',
          entityType: 'rate_card_lanes',
          entityId: successor.id,
          before: { laneId: lane.id, rate: Number(lane.rate), validTo: lane.valid_to },
          after: { laneId: successor.id, rate: rows.successor.ratePaise, validFrom: rows.successor.validFrom },
        },
      );
    });
  }

  // ---- Bid band -------------------------------------------------------

  /**
   * Sets or changes the bid band on a client's lane.
   *
   * The first band on a lane applies straight away — that is the moment the
   * rate is being set up and nobody is being overruled. Changing a band that
   * is already in force is different: it moves the floor and ceiling every
   * later indent on this lane is judged against, so it goes to Leadership
   * (`LANE_BAND_CHANGE`) and only lands when they approve. Indents already
   * raised keep the band they were raised with.
   */
  async setLaneBand(
    clientId: string,
    laneId: string,
    dto: SetLaneBandDto,
    actor: AuthenticatedUser,
  ): Promise<ApprovalRequiredResponse | { applied: true; laneId: string; bidMinPaise: number; bidMaxPaise: number }> {
    const client = await this.clientsRepository.findById(clientId);
    if (!client) throw new DomainException(404, 'NOT_FOUND', `Unknown client: ${clientId}`);

    const lane = await this.clientsRepository.findLane(laneId);
    if (!lane) throw new DomainException(404, 'NOT_FOUND', `Unknown rate card lane: ${laneId}`);
    if (lane.client_id !== clientId) {
      throw new DomainException(400, 'LANE_NOT_ON_CLIENT', 'That lane belongs to a different client.');
    }
    if (dto.bidMaxPaise < dto.bidMinPaise) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'The bid maximum cannot be below the bid minimum.');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (lane.valid_to && lane.valid_to < today) {
      throw new DomainException(
        400,
        'LANE_ALREADY_CLOSED',
        `That agreed rate ended on ${lane.valid_to}. Set the band on the lane now in force.`,
      );
    }

    const hasBand = lane.bid_min !== null || lane.bid_max !== null;
    if (!hasBand) {
      await this.clientsRepository.transaction().execute(async (trx) => {
        await this.clientsRepository.updateLaneBand(trx, lane.id, {
          bid_min: dto.bidMinPaise,
          bid_max: dto.bidMaxPaise,
        });
        await this.auditService.record(trx, actor, {
          action: 'LANE_BAND_SET',
          entityType: 'rate_card_lanes',
          entityId: lane.id,
          before: { bidMinPaise: null, bidMaxPaise: null },
          after: { bidMinPaise: dto.bidMinPaise, bidMaxPaise: dto.bidMaxPaise },
        });
      });
      return { applied: true, laneId: lane.id, bidMinPaise: dto.bidMinPaise, bidMaxPaise: dto.bidMaxPaise };
    }

    if (lane.bid_min === dto.bidMinPaise && lane.bid_max === dto.bidMaxPaise) {
      throw new DomainException(400, 'BAND_UNCHANGED', 'That is the band already in force — nothing would change.');
    }
    if (!dto.reason || dto.reason.trim().length < 20) {
      throw new DomainException(
        400,
        'REASON_TOO_SHORT',
        'Say why the band is changing (at least 20 characters). Leadership decides it from this.',
      );
    }

    const action: LaneBandAction = {
      laneId: lane.id,
      bidMinPaise: dto.bidMinPaise,
      bidMaxPaise: dto.bidMaxPaise,
    };
    return this.approvalsService.raise(
      {
        kind: 'LANE_BAND_CHANGE',
        entityType: 'clients',
        entityId: clientId,
        reason: dto.reason,
        title: `Bid band change · ${client.name} · ${lane.origin} → ${lane.destination}`,
        detail:
          `${rupees(Number(lane.bid_min ?? 0))}–${rupees(Number(lane.bid_max ?? 0))} → ` +
          `${rupees(dto.bidMinPaise)}–${rupees(dto.bidMaxPaise)} (${lane.truck_type})`,
        amountPaise: null,
        action,
      },
      actor,
    );
  }

  // ---- Add a lane -----------------------------------------------------

  /**
   * Lanes proposed for this client and still waiting for approval.
   *
   * The rate card only lists lanes that exist, and a new lane does not exist
   * until it is approved — so after "Add a lane" nothing on the client showed
   * that anything had happened, and the same lane was added again. The client
   * page lists these beside the rate card as "Waiting for approval".
   */
  async pendingLanes(clientId: string) {
    const rows = await this.approvalsService.pendingFor<RateCardLaneAction>('RATE_CARD_LANE', 'clients', clientId);
    return rows.map((r) => ({
      approvalId: r.approvalId,
      requesterName: r.requesterName,
      proposedAt: r.createdAt,
      origin: r.action.origin,
      destination: r.action.destination,
      truckType: r.action.truckType,
      ratePaise: r.action.ratePaise,
      rateBasis: r.action.rateBasis ?? 'FTL',
      transitDays: r.action.transitDays,
      validFrom: r.action.validFrom,
      validTo: r.action.validTo,
    }));
  }

  // ---- Delete a duplicate ---------------------------------------------

  /**
   * Takes a lane off the rate card — a duplicate entered twice. Leadership or
   * an administrator only. The row is kept and marked deleted: loads already
   * raised on it still point at it and keep the price they were raised at. A
   * rate change waiting on the lane is withdrawn with it, since it would
   * otherwise re-create the lane on approval.
   */
  async deleteLane(clientId: string, laneId: string, reason: string, actor: AuthenticatedUser) {
    assertCanDeleteRates(actor);
    const why = assertDeleteReason(reason);
    const lane = await this.clientsRepository.findLane(laneId);
    if (!lane || lane.client_id !== clientId || lane.deleted_at) {
      throw new DomainException(404, 'NOT_FOUND', 'That rate is not on this client’s rate card.');
    }

    const open = await this.clientsRepository.findOpenRevisionForLane(lane.id);
    if (open?.approval_id) {
      await this.approvalsService.withdraw(open.approval_id, `Deleted with its lane: ${why}`, actor, {
        kind: 'RATE_REVISION',
        entityType: 'clients',
        entityId: clientId,
      });
    }

    await this.clientsRepository.transaction().execute(async (trx) => {
      if (open) await this.clientsRepository.updateRevision(trx, open.id, { status: 'REJECTED' });
      const deleted = await this.clientsRepository.markLaneDeleted(trx, lane.id, {
        deleted_by: actor.userId,
        delete_reason: why,
      });
      if (!deleted) throw new DomainException(409, 'ALREADY_DELETED', 'That rate has already been deleted.');
      await this.auditService.record(trx, actor, {
        action: 'RATE_LANE_DELETED',
        entityType: 'rate_card_lanes',
        entityId: lane.id,
        before: {
          route: `${lane.origin} → ${lane.destination}`,
          truckType: lane.truck_type,
          rate: Number(lane.rate),
          rateBasis: lane.rate_basis,
        },
        after: { deleted: true, reason: why },
      });
    });
    return { laneId: lane.id, deleted: true };
  }

  /** Removes a lane still waiting for sign-off — a duplicate proposal. Leadership or an administrator only. */
  async deletePendingLane(clientId: string, approvalId: string, reason: string, actor: AuthenticatedUser) {
    assertCanDeleteRates(actor);
    const why = assertDeleteReason(reason);
    await this.approvalsService.withdraw(approvalId, `Deleted: ${why}`, actor, {
      kind: 'RATE_CARD_LANE',
      entityType: 'clients',
      entityId: clientId,
    });
    return { approvalId, deleted: true };
  }

  /** Removes a rate change still waiting for sign-off. Leadership or an administrator only. */
  async deleteRevision(clientId: string, revisionId: string, reason: string, actor: AuthenticatedUser) {
    assertCanDeleteRates(actor);
    const why = assertDeleteReason(reason);
    const revision = await this.clientsRepository.findRevision(revisionId);
    if (!revision || revision.client_id !== clientId) {
      throw new DomainException(404, 'NOT_FOUND', 'That rate change is not on this client.');
    }
    if (revision.status !== 'PENDING') {
      throw new DomainException(409, 'ALREADY_DECIDED', 'Only a rate change still waiting for sign-off can be deleted.');
    }
    if (revision.approval_id) {
      await this.approvalsService.withdraw(revision.approval_id, `Deleted: ${why}`, actor, {
        kind: 'RATE_REVISION',
        entityType: 'clients',
        entityId: clientId,
      });
    }
    await this.clientsRepository.transaction().execute(async (trx) => {
      await this.clientsRepository.updateRevision(trx, revisionId, { status: 'REJECTED' });
      await this.auditService.record(trx, actor, {
        action: 'RATE_REVISION_DELETED',
        entityType: 'rate_revisions',
        entityId: revisionId,
        after: { reason: why },
      });
    });
    return { revisionId, deleted: true };
  }

  /**
   * Proposes a lane for a client who has no agreed rate on that route yet.
   * Never writes the lane — the approval handler does, once somebody who can
   * approve a contract agrees. Returns `202 approvalRequired`.
   */
  async addLane(clientId: string, dto: AddRateLaneDto, actor: AuthenticatedUser): Promise<ApprovalRequiredResponse> {
    const client = await this.clientsRepository.findById(clientId);
    if (!client) throw new DomainException(404, 'NOT_FOUND', `Unknown client: ${clientId}`);
    if (client.engagement !== 'CONTRACT') {
      throw new DomainException(
        400,
        'CLIENT_IS_SPOT',
        'This client is priced load by load, so there is no rate card to add to. Change them to a contract client first.',
      );
    }

    const input = {
      origin: routePart(dto.origin),
      destination: routePart(dto.destination),
      truckType: routePart(dto.truckType),
      ratePaise: dto.ratePaise,
      transitDays: dto.transitDays,
      validFrom: dto.validFrom,
      validTo: dto.validTo ?? null,
      reason: dto.reason.trim(),
      transitPenaltyApplies: dto.transitPenaltyApplies,
      transitPenaltyPerDayPaise: dto.transitPenaltyApplies ? (dto.transitPenaltyPerDayPaise ?? 0) : 0,
      approvalMailSubject: dto.approvalMailSubject.trim(),
      approvalMailAttachmentId: dto.approvalMailAttachmentId ?? null,
      rateBasis: (dto.rateBasis ?? 'FTL') as RateBasis,
    };

    // A lane already proposed and waiting for approval is not on the rate card
    // yet, so nothing below would see it — and people re-added lanes they could
    // not see, raising the same approval twice. Refuse by name instead.
    const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
    const waiting = (await this.pendingLanes(clientId)).find(
      (p) => same(p.origin, input.origin) && same(p.destination, input.destination) && same(p.truckType, input.truckType),
    );
    if (waiting) {
      throw new DomainException(
        409,
        'RATE_LANE_PENDING',
        `${input.origin} → ${input.destination} · ${input.truckType} is already waiting for approval ` +
          `(proposed by ${waiting.requesterName}). It appears on the rate card once it is approved.`,
      );
    }

    const sameRoute = await this.clientsRepository.findRouteLanes(
      clientId,
      input.origin,
      input.destination,
      input.truckType,
    );
    const check = checkNewLane(
      input,
      sameRoute.map((l) => ({ id: l.id, validFrom: l.valid_from, validTo: l.valid_to })),
    );
    if (!check.ok) {
      throw new DomainException(400, `RATE_LANE_${check.refusal}`, check.reason ?? 'That lane is not valid.');
    }

    const action: RateCardLaneAction = { clientId, ...input };
    return this.approvalsService.raise(
      {
        kind: 'RATE_CARD_LANE',
        entityType: 'clients',
        entityId: clientId,
        reason: input.reason,
        title: `New agreed rate · ${client.name} · ${input.origin} → ${input.destination}`,
        detail:
          `${rateLabel(input.ratePaise, input.rateBasis)} · ${input.truckType} · ${input.transitDays} days · from ${input.validFrom}` +
          (input.transitPenaltyApplies ? ` · late penalty ${rupees(input.transitPenaltyPerDayPaise)}/day` : ' · no late penalty') +
          ` · mail: ${input.approvalMailSubject}`,
        amountPaise: input.ratePaise,
        action,
      },
      actor,
    );
  }

  // ---- Propose --------------------------------------------------------

  async propose(
    clientId: string,
    dto: ProposeRateRevisionDto,
    actor: AuthenticatedUser,
  ): Promise<ApprovalRequiredResponse> {
    const client = await this.clientsRepository.findById(clientId);
    if (!client) throw new DomainException(404, 'NOT_FOUND', `Unknown client: ${clientId}`);

    const lane = await this.clientsRepository.findLane(dto.laneId);
    if (!lane) throw new DomainException(404, 'NOT_FOUND', `Unknown rate card lane: ${dto.laneId}`);

    if (lane.client_id !== clientId) {
      // The lane id comes from the body and the client id from the path;
      // nothing else would stop one client's revision being filed against
      // another client's lane.
      throw new DomainException(400, 'LANE_NOT_ON_CLIENT', 'That lane belongs to a different client.');
    }

    const open = await this.clientsRepository.findOpenRevisionForLane(lane.id);
    if (open) {
      /*
       * One at a time. Two pending revisions on the same lane would both be
       * approvable, and whichever was signed second would close a lane the
       * first had already closed — leaving the earlier successor live at a
       * rate nobody approved last.
       */
      throw new DomainException(
        409,
        'REVISION_ALREADY_PENDING',
        'A revision for this lane is already waiting for approval. Decide that one first.',
      );
    }

    // A late-delivery penalty that applies must carry an amount.
    if (dto.transitPenaltyApplies === true && !(dto.transitPenaltyPerDayPaise && dto.transitPenaltyPerDayPaise > 0)) {
      throw new DomainException(400, 'RATE_REVISION_PENALTY_AMOUNT', 'Enter what a late day costs, or switch the late-delivery penalty off.');
    }

    const check = checkRevision(
      toLane(lane),
      { newRatePaise: dto.newRatePaise, effectiveFrom: dto.effectiveFrom, reason: dto.reason },
      new Date(),
    );

    if (!check.ok) {
      throw new DomainException(400, `RATE_REVISION_${check.refusal}`, check.reason ?? 'That revision is not valid.');
    }

    const revision = await this.clientsRepository.transaction().execute((trx) =>
      this.clientsRepository.insertRevision(trx, {
        client_id: clientId,
        from_lane_id: lane.id,
        old_rate: Number(lane.rate),
        new_rate: dto.newRatePaise,
        effective_from: dto.effectiveFrom,
        reason: dto.reason,
        approval_id: null,
        requested_by: actor.userId,
        approval_mail_subject: dto.approvalMailSubject.trim(),
        approval_mail_attachment_id: dto.approvalMailAttachmentId ?? null,
        transit_penalty_applies: dto.transitPenaltyApplies ?? null,
        transit_penalty_per_day: dto.transitPenaltyApplies === false ? 0 : (dto.transitPenaltyPerDayPaise ?? null),
      }),
    );

    const action: RateRevisionAction = { revisionId: revision.id };
    const response = await this.approvalsService.raise(
      {
        kind: 'RATE_REVISION',
        entityType: 'clients',
        entityId: clientId,
        reason: dto.reason,
        title: `Rate change · ${client.name} · ${lane.origin} → ${lane.destination}`,
        detail: `${rupees(Number(lane.rate))} → ${rupees(dto.newRatePaise)} from ${dto.effectiveFrom} (${lane.truck_type})`,
        amountPaise: dto.newRatePaise,
        action,
      },
      actor,
    );

    // Linked after the fact because `raise()` owns the approval id. Without
    // this the revision row could not name the signature that authorised it,
    // which is half the reason for keeping the row at all.
    await this.clientsRepository.transaction().execute((trx) =>
      this.clientsRepository.updateRevision(trx, revision.id, { approval_id: response.approval.id }),
    );

    return response;
  }

  // ---- Read -----------------------------------------------------------

  async list(clientId: string) {
    const rows = await this.clientsRepository.listRevisions(clientId);
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      oldRatePaise: Number(r.oldRate),
      newRatePaise: Number(r.newRate),
      effectiveFrom: r.effectiveFrom,
      reason: r.reason,
      lane: r.origin ? `${r.origin} → ${r.destination}` : null,
      truckType: r.truckType,
      requestedByName: r.requestedByName,
      createdAt: r.createdAt,
    }));
  }
}

/** `selectAll()` returns snake_case straight from the table. */
function toLane(row: {
  id: string;
  client_id: string;
  origin: string;
  destination: string;
  truck_type: string;
  rate: number;
  valid_from: string;
  valid_to: string | null;
}): LaneForRevision {
  return {
    id: row.id,
    clientId: row.client_id,
    origin: row.origin,
    destination: row.destination,
    truckType: row.truck_type,
    ratePaise: Number(row.rate),
    validFrom: row.valid_from,
    validTo: row.valid_to,
  };
}

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN')}`;
}
