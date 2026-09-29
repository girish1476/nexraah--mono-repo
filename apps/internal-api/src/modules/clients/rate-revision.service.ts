import { Injectable, OnModuleInit } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { ApprovalRequiredResponse } from '../../common/approval-required.response';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalsRegistry } from '../approvals/approvals.registry';
import { ClientsRepository } from './clients.repository';
import { ProposeRateRevisionDto } from './dto/propose-rate-revision.dto';
import { checkRevision, revisionRows, type LaneForRevision } from './rate-revision';

/** Replayed verbatim on approval. Only the id — everything else is re-read under lock. */
interface RateRevisionAction {
  revisionId: string;
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
