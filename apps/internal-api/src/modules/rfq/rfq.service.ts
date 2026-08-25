import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { ConfigRepository } from '../config/config.repository';
import { SUPPLY_SOURCE_LABEL, type SupplySourceCode } from '../branches/branches.constants';
import { RfqRepository, type RfqListFilters } from './rfq.repository';
import type { CreateRfqDto } from './dto/create-rfq.dto';
import type { AddLaneDto } from './dto/add-lane.dto';
import type { SetSourcingDto } from './dto/set-sourcing.dto';
import type { SetBuildupDto } from './dto/set-buildup.dto';
import type { AwardRfqDto } from './dto/award-rfq.dto';

@Injectable()
export class RfqService {
  constructor(
    private readonly rfqRepository: RfqRepository,
    private readonly configRepository: ConfigRepository,
    private readonly auditService: AuditService,
  ) {}

  async list(filters: RfqListFilters) {
    const [stats, rows] = await Promise.all([this.rfqRepository.stats(), this.rfqRepository.list(filters)]);
    return {
      stats,
      rows: rows.map((r) => ({
        id: r.id,
        clientName: r.clientName,
        reference: r.reference ?? '',
        cycleMonths: r.cycleMonths,
        periodFrom: r.periodFrom,
        periodTo: r.periodTo,
        dueAt: r.dueAt,
        status: r.status,
        laneCount: Number(r.laneCount),
      })),
    };
  }

  async getById(id: string) {
    const rfq = await this.rfqRepository.findById(id);
    if (!rfq) throw new DomainException(404, 'NOT_FOUND', `Unknown RFQ: ${id}`);

    const lanes = await this.rfqRepository.findLanesForRfq(id);
    const sourcing = await this.rfqRepository.findSourcingForLanes(lanes.map((l) => l.id));
    const sourcingByLane = new Map<string, typeof sourcing>();
    for (const row of sourcing) {
      const list = sourcingByLane.get(row.rfq_lane_id) ?? [];
      list.push(row);
      sourcingByLane.set(row.rfq_lane_id, list);
    }

    return {
      id: rfq.id,
      clientId: rfq.clientId,
      clientName: rfq.clientName,
      cycleMonths: rfq.cycleMonths,
      periodFrom: rfq.periodFrom,
      periodTo: rfq.periodTo,
      dueAt: rfq.dueAt,
      reference: rfq.reference ?? '',
      status: rfq.status,
      submittedBy: rfq.submittedBy,
      submittedAt: rfq.submittedAt,
      lanes: lanes.map((lane) => this.laneDto(lane, sourcingByLane.get(lane.id) ?? [])),
    };
  }

  async create(dto: CreateRfqDto, actor: AuthenticatedUser) {
    const client = await this.rfqRepository.findClientById(dto.clientId);
    if (!client) throw new DomainException(404, 'NOT_FOUND', `Unknown client: ${dto.clientId}`);

    return this.rfqRepository.transaction().execute(async (trx) => {
      const id = randomUUID();
      const row = await this.rfqRepository.insertRfq(trx, {
        id,
        client_id: dto.clientId,
        cycle_months: dto.cycleMonths,
        period_from: dto.periodFrom,
        period_to: dto.periodTo,
        due_at: dto.dueAt ?? null,
        reference: dto.reference ?? null,
      });

      await this.auditService.record(trx, actor, {
        action: 'RFQ_CREATED',
        entityType: 'rfqs',
        entityId: id,
        after: { clientId: dto.clientId, cycleMonths: dto.cycleMonths },
      });

      return {
        id: row.id,
        clientId: row.client_id,
        clientName: client.name,
        cycleMonths: row.cycle_months,
        periodFrom: row.period_from,
        periodTo: row.period_to,
        dueAt: row.due_at,
        reference: row.reference ?? '',
        status: row.status,
        submittedBy: row.submitted_by,
        submittedAt: row.submitted_at,
        lanes: [],
      };
    });
  }

  async addLane(rfqId: string, dto: AddLaneDto, actor: AuthenticatedUser) {
    return this.rfqRepository.transaction().execute(async (trx) => {
      const rfq = await this.rfqRepository.findByIdForUpdate(trx, rfqId);
      if (!rfq) throw new DomainException(404, 'NOT_FOUND', `Unknown RFQ: ${rfqId}`);

      const id = randomUUID();
      const lane = await this.rfqRepository.insertLane(trx, {
        id,
        rfq_id: rfqId,
        origin: dto.origin,
        destination: dto.destination,
        truck_type: dto.truckType,
        transit_days: dto.transitDays,
        reporting_rule: dto.reportingRule,
      });

      // Unconditional, matching the mock: adding a lane always (re-)opens
      // sourcing, even on an already-QUOTED rfq.
      await this.rfqRepository.updateRfq(trx, rfqId, { status: 'SOURCING' });

      await this.auditService.record(trx, actor, {
        action: 'RFQ_LANE_ADDED',
        entityType: 'rfq_lanes',
        entityId: id,
        after: { rfqId, origin: dto.origin, destination: dto.destination },
      });

      return this.laneDto(lane, []);
    });
  }

  async setSourcing(rfqId: string, laneId: string, dto: SetSourcingDto, actor: AuthenticatedUser) {
    if (dto.sourcingMode === 'HIGH_LOW' && dto.sourcingRows.length !== 2) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'HIGH_LOW sourcing needs exactly two rows.');
    }

    return this.rfqRepository.transaction().execute(async (trx) => {
      const lane = await this.rfqRepository.findLaneForUpdate(trx, laneId);
      if (!lane || lane.rfq_id !== rfqId) throw new DomainException(404, 'NOT_FOUND', `Unknown lane: ${laneId}`);

      await this.rfqRepository.replaceSourcing(
        trx,
        laneId,
        dto.sourcingRows.map((r) => ({ month: r.month ?? null, rate: r.ratePaise })),
      );

      // Mean of every rate > 0 — the same formula for MONTHLY and HIGH_LOW;
      // for exactly two rows this is the midpoint the docs describe.
      const positive = dto.sourcingRows.map((r) => r.ratePaise).filter((r) => r > 0);
      const avg = positive.length ? Math.round(positive.reduce((a, b) => a + b, 0) / positive.length) : 0;
      const quotedRate = avg + (lane.overhead ?? 0) + (lane.margin ?? 0); // BR-36

      // Supply source is only patched when the caller sent the key at all —
      // a sourcing save that leaves the dropdown alone must not wipe a source
      // recorded on an earlier pass. Explicit null clears it.
      const patch: Record<string, unknown> = {
        sourcing_mode: dto.sourcingMode,
        sourcing_avg: avg,
        quoted_rate: quotedRate,
      };
      if (dto.supplySource !== undefined) patch.supply_source = dto.supplySource;
      if (dto.supplyRemarks !== undefined) patch.supply_remarks = dto.supplyRemarks;

      const updated = await this.rfqRepository.updateLane(trx, laneId, patch);

      await this.auditService.record(trx, actor, {
        action: 'RFQ_LANE_SOURCING_UPDATED',
        entityType: 'rfq_lanes',
        entityId: laneId,
        before: { supplySource: lane.supply_source, supplyRemarks: lane.supply_remarks },
        after: {
          sourcingMode: dto.sourcingMode,
          sourcingAvgPaise: avg,
          quotedRatePaise: quotedRate,
          supplySource: updated.supply_source,
          supplyRemarks: updated.supply_remarks,
        },
      });

      const sourcing = await this.rfqRepository.findSourcingForLanes([laneId]);
      return this.laneDto(updated, sourcing);
    });
  }

  async setBuildup(rfqId: string, laneId: string, dto: SetBuildupDto, actor: AuthenticatedUser) {
    return this.rfqRepository.transaction().execute(async (trx) => {
      const lane = await this.rfqRepository.findLaneForUpdate(trx, laneId);
      if (!lane || lane.rfq_id !== rfqId) throw new DomainException(404, 'NOT_FOUND', `Unknown lane: ${laneId}`);

      const quotedRate = (lane.sourcing_avg ?? 0) + dto.overheadPaise + dto.marginPaise; // BR-36
      const updated = await this.rfqRepository.updateLane(trx, laneId, {
        overhead: dto.overheadPaise,
        margin: dto.marginPaise,
        quoted_rate: quotedRate,
      });

      await this.rfqRepository.updateRfq(trx, rfqId, { status: 'QUOTED' });

      const config = await this.configRepository.findAll();
      const minimumMarginPct = Number(config.get('minimum_margin_pct') ?? 0);
      const marginPct = quotedRate ? (dto.marginPaise / quotedRate) * 100 : 0;
      const belowMinimumMargin = marginPct < minimumMarginPct;

      await this.auditService.record(trx, actor, {
        action: 'RFQ_LANE_BUILDUP_UPDATED',
        entityType: 'rfq_lanes',
        entityId: laneId,
        after: { overheadPaise: dto.overheadPaise, marginPaise: dto.marginPaise, quotedRatePaise: quotedRate, belowMinimumMargin },
      });

      const sourcing = await this.rfqRepository.findSourcingForLanes([laneId]);
      return this.laneDto(updated, sourcing);
    });
  }

  /**
   * `rfq.submit` is a FIXED_PERMISSIONS entry seeded only to LEADERSHIP —
   * `@RequirePermission('rfq.submit')` on the controller already refuses
   * every other role, and `RolesService` refuses to let it be granted
   * elsewhere, so no extra role check happens here (mirrors how
   * `PaymentsController` does zero extra role-checking beyond the guard).
   */
  async submit(rfqId: string, actor: AuthenticatedUser) {
    return this.rfqRepository.transaction().execute(async (trx) => {
      const rfq = await this.rfqRepository.findByIdForUpdate(trx, rfqId);
      if (!rfq) throw new DomainException(404, 'NOT_FOUND', `Unknown RFQ: ${rfqId}`);

      const updated = await this.rfqRepository.updateRfq(trx, rfqId, {
        status: 'SUBMITTED',
        submitted_by: actor.userId,
        submitted_at: new Date().toISOString(),
      });

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'rfqs',
        entityId: rfqId,
        after: { status: 'SUBMITTED' },
      });

      const client = await this.rfqRepository.findClientById(updated.client_id);
      const lanes = await this.rfqRepository.findLanesForRfq(rfqId);
      const sourcing = await this.rfqRepository.findSourcingForLanes(lanes.map((l) => l.id));
      const sourcingByLane = new Map<string, typeof sourcing>();
      for (const row of sourcing) {
        const list = sourcingByLane.get(row.rfq_lane_id) ?? [];
        list.push(row);
        sourcingByLane.set(row.rfq_lane_id, list);
      }
      return {
        id: updated.id,
        clientId: updated.client_id,
        clientName: client?.name ?? '',
        cycleMonths: updated.cycle_months,
        periodFrom: updated.period_from,
        periodTo: updated.period_to,
        dueAt: updated.due_at,
        reference: updated.reference ?? '',
        status: updated.status,
        submittedBy: updated.submitted_by,
        submittedAt: updated.submitted_at,
        lanes: lanes.map((lane) => this.laneDto(lane, sourcingByLane.get(lane.id) ?? [])),
      };
    });
  }

  async award(rfqId: string, dto: AwardRfqDto, actor: AuthenticatedUser) {
    return this.rfqRepository.transaction().execute(async (trx) => {
      const rfq = await this.rfqRepository.findByIdForUpdate(trx, rfqId);
      if (!rfq) throw new DomainException(404, 'NOT_FOUND', `Unknown RFQ: ${rfqId}`);

      const lanes = await this.rfqRepository.findLanesForRfq(rfqId);
      const byId = new Map(lanes.map((l) => [l.id, l]));

      const created: {
        id: string;
        rfqLaneId: string;
        origin: string;
        destination: string;
        truckType: string;
        ratePaise: number;
        validFrom: string;
        validTo: string | null;
        supplySource: SupplySourceCode | null;
        supplySourceLabel: string | null;
        supplyRemarks: string | null;
      }[] = [];

      for (const decision of dto.lanes) {
        const lane = byId.get(decision.laneId);
        // Deliberate divergence from the mock, which silently skips an
        // unknown laneId — every other sub-resource lookup in this codebase
        // 404s on a bad id instead of no-op-ing.
        if (!lane) throw new DomainException(404, 'NOT_FOUND', `Unknown lane: ${decision.laneId}`);

        await this.rfqRepository.updateLane(trx, lane.id, {
          outcome: decision.outcome,
          awarded_rate: decision.awardedRatePaise ?? null,
        });

        if (decision.outcome === 'WON') {
          const ratePaise = decision.awardedRatePaise ?? lane.quoted_rate ?? 0;
          if (ratePaise <= 0) {
            throw new DomainException(400, 'VALIDATION_ERROR', `Lane ${lane.origin} → ${lane.destination} has no usable rate to award.`);
          }
          const id = randomUUID();
          const rateCardRow = await this.rfqRepository.insertRateCardLane(trx, {
            id,
            client_id: rfq.client_id,
            rfq_lane_id: lane.id,
            origin: lane.origin,
            destination: lane.destination,
            truck_type: lane.truck_type,
            rate: ratePaise,
            transit_days: lane.transit_days,
            reporting_rule: lane.reporting_rule,
            valid_from: rfq.period_from,
            valid_to: rfq.period_to,
            // What sourcing discovered becomes the agreed supply basis on the
            // rate sheet — copied, not linked, because the rate card line must
            // still say "union" a year later even if the RFQ lane is re-worked.
            supply_source: lane.supply_source,
            supply_remarks: lane.supply_remarks,
          });
          created.push({
            id: rateCardRow.id,
            rfqLaneId: rateCardRow.rfq_lane_id,
            origin: rateCardRow.origin,
            destination: rateCardRow.destination,
            truckType: rateCardRow.truck_type,
            ratePaise: rateCardRow.rate,
            validFrom: rateCardRow.valid_from,
            validTo: rateCardRow.valid_to,
            supplySource: rateCardRow.supply_source,
            supplySourceLabel: rateCardRow.supply_source
              ? SUPPLY_SOURCE_LABEL[rateCardRow.supply_source]
              : null,
            supplyRemarks: rateCardRow.supply_remarks,
          });
        }
      }

      const newStatus = created.length > 0 ? 'AWARDED' : 'LOST';
      await this.rfqRepository.updateRfq(trx, rfqId, { status: newStatus });

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'rfqs',
        entityId: rfqId,
        after: { status: newStatus, rateCardLanesCreated: created },
      });

      return { rfqId, status: newStatus, rateCardLanesCreated: created };
    });
  }

  // ---- Helpers ----------------------------------------------------------

  private laneDto(
    lane: {
      id: string;
      origin: string;
      destination: string;
      truck_type: string;
      transit_days: number | null;
      reporting_rule: string | null;
      sourcing_mode: string | null;
      sourcing_avg: number | null;
      overhead: number | null;
      margin: number | null;
      quoted_rate: number | null;
      outcome: string | null;
      awarded_rate: number | null;
      supply_source: SupplySourceCode | null;
      supply_remarks: string | null;
    },
    sourcing: { month: string | null; rate: number }[],
  ) {
    return {
      id: lane.id,
      origin: lane.origin,
      destination: lane.destination,
      truckType: lane.truck_type,
      transitDays: lane.transit_days ?? 0,
      reportingRule: lane.reporting_rule,
      sourcingMode: lane.sourcing_mode,
      sourcingRows: sourcing.map((s) => ({ month: s.month, ratePaise: s.rate })),
      sourcingAvgPaise: lane.sourcing_avg ?? 0,
      overheadPaise: lane.overhead ?? 0,
      marginPaise: lane.margin ?? 0,
      quotedRatePaise: lane.quoted_rate ?? 0,
      outcome: lane.outcome,
      awardedRatePaise: lane.awarded_rate,
      supplySource: lane.supply_source,
      supplySourceLabel: lane.supply_source ? SUPPLY_SOURCE_LABEL[lane.supply_source] : null,
      supplyRemarks: lane.supply_remarks,
    };
  }
}
