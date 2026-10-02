import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SetTargetsDto } from './targets.dto';
import { TargetsRepository } from './targets.repository';
import {
  TARGET_METRICS,
  TARGET_UNIT,
  addMonths,
  currentMonth,
  isMonth,
  metricsForRole,
  monthStart,
  quarterOf,
  type TargetMetric,
} from './target-rules';

type Figures = Record<TargetMetric, number>;

@Injectable()
export class TargetsService {
  constructor(
    private readonly targetsRepository: TargetsRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * `GET /targets/desk` — this month and this quarter, target against
   * achieved, in the measures the caller's desk is held to. A caller with a
   * branch sees that branch; anyone else sees every branch together.
   */
  async desk(user: AuthenticatedUser) {
    const role = user.customRole?.basedOn ?? user.role;
    const metrics = metricsForRole(role);
    const branchId = user.branch?.id ?? null;
    const month = currentMonth();
    const quarter = quarterOf(month);

    const monthRange = [monthStart(month), monthStart(addMonths(month, 1))] as const;
    const quarterRange = [monthStart(quarter.from), monthStart(addMonths(quarter.to, 1))] as const;

    const [monthTargets, quarterTargets, monthAchieved, quarterAchieved] = await Promise.all([
      this.targets(branchId, ...monthRange),
      this.targets(branchId, ...quarterRange),
      this.achieved(branchId, ...monthRange),
      this.achieved(branchId, ...quarterRange),
    ]);

    return {
      month,
      quarter,
      branchName: user.branch?.name ?? null,
      targets: metrics.map((metric) => ({
        metric,
        unit: TARGET_UNIT[metric],
        month: { target: monthTargets[metric] ?? null, achieved: monthAchieved[metric] },
        quarter: { target: quarterTargets[metric] ?? null, achieved: quarterAchieved[metric] },
      })),
    };
  }

  /** `GET /targets?month=` — every branch and what has been set for it that month. */
  async list(month: string | undefined) {
    const forMonth = isMonth(month) ? month : currentMonth();
    const [branches, rows] = await Promise.all([
      this.targetsRepository.branches(),
      this.targetsRepository.forMonth(monthStart(forMonth)),
    ]);
    return {
      month: forMonth,
      rows: branches.map((b) => ({
        branchId: b.id,
        branchName: b.name,
        targets: Object.fromEntries(
          TARGET_METRICS.map((metric) => [
            metric,
            rows.find((r) => r.branchId === b.id && r.metric === metric)?.target ?? null,
          ]),
        ) as Record<TargetMetric, number | null>,
      })),
    };
  }

  /** `PUT /targets` · `config.manage` — set or clear one branch's targets for one month. */
  async set(dto: SetTargetsDto, actor: AuthenticatedUser) {
    const entries = Object.entries(dto.targets) as [TargetMetric, number | null][];
    for (const [metric, value] of entries) {
      if (!TARGET_METRICS.includes(metric)) {
        throw new BadRequestException(`"${metric}" is not something a target can be set in.`);
      }
      if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
        throw new BadRequestException('A target is a whole number, zero or more.');
      }
    }

    const branches = await this.targetsRepository.branches();
    if (!branches.some((b) => b.id === dto.branchId)) throw new NotFoundException('No such branch.');

    const month = monthStart(dto.month);
    await this.targetsRepository.transaction().execute(async (trx) => {
      for (const [metric, value] of entries) {
        if (value === null) await this.targetsRepository.clear(trx, dto.branchId, month, metric);
        else await this.targetsRepository.set(trx, { branchId: dto.branchId, month, metric, target: value, setBy: actor.userId });
      }
      await this.auditService.record(trx, actor, {
        action: 'TARGETS_SET',
        entityType: 'branch_targets',
        entityId: dto.branchId,
        after: { month: dto.month, targets: dto.targets },
      });
    });

    return this.list(dto.month);
  }

  private async targets(branchId: string | null, from: string, to: string): Promise<Partial<Figures>> {
    const rows = await this.targetsRepository.totals(branchId, from, to);
    return Object.fromEntries(rows.map((r) => [r.metric, Number(r.total)]));
  }

  private async achieved(branchId: string | null, from: string, to: string): Promise<Figures> {
    const [delivered, collected, pods] = await Promise.all([
      this.targetsRepository.delivered(branchId, from, to),
      this.targetsRepository.collected(branchId, from, to),
      this.targetsRepository.podsApproved(branchId, from, to),
    ]);
    const revenue = Number(delivered.revenue);
    return {
      LOADS: Number(delivered.loads),
      REVENUE: revenue,
      MARGIN: revenue - Number(delivered.cost),
      COLLECTIONS: Number(collected.total),
      PODS: Number(pods.c),
    };
  }
}
