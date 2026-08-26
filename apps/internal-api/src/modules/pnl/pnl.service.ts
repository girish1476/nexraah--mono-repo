import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PnlRepository } from './pnl.repository';

interface PnlQuery {
  granularity?: string;
  from?: string;
  to?: string;
  branch?: string;
}

/**
 * docs/api/09-reporting.md `GET /pnl` (BR-35, D-05). Cost is built entirely
 * from actual rows — `trips.buy_rate` (placement) plus every `trip_charges`
 * line, bucketed into the four named columns the response carries. No
 * percentage, no flat overhead, anywhere in this file.
 */
@Injectable()
export class PnlService {
  constructor(private readonly pnlRepository: PnlRepository) {}

  async pnl(user: AuthenticatedUser, query: PnlQuery) {
    const canViewAll = (user.permissions.get('pnl.view_all') ?? 'NONE') !== 'NONE';
    const canViewOwn = (user.permissions.get('pnl.view_own') ?? 'NONE') !== 'NONE';
    if (!canViewAll && !canViewOwn) {
      throw new DomainException(403, 'PERMISSION_DENIED', 'Missing permission: pnl.view_all or pnl.view_own.');
    }

    // A caller with view_own but not view_all is always forced to their own
    // branch — a ?branch= query from that caller is not honoured, matching
    // "scoping happens at the repository layer, never the frontend" (part 09).
    const forcedBranchId = !canViewAll ? (user.branch?.id ?? null) : null;
    const branchId = forcedBranchId ?? (canViewAll ? (query.branch ?? null) : null);

    const { from, to } = resolveRange(query.from, query.to);
    const [trips, charges] = await Promise.all([
      this.pnlRepository.tripsInRange(branchId, from, to),
      this.pnlRepository.chargesInRange(branchId, from, to),
    ]);

    const chargeBuckets = new Map<string, { loading: number; unloading: number; detention: number; other: number }>();
    for (const c of charges) {
      const acc = chargeBuckets.get(c.tripId) ?? { loading: 0, unloading: 0, detention: 0, other: 0 };
      if (c.chargeType === 'LOADING') acc.loading += c.costAmountPaise;
      else if (c.chargeType === 'UNLOADING') acc.unloading += c.costAmountPaise;
      else if (c.chargeType === 'DETENTION') acc.detention += c.costAmountPaise;
      else acc.other += c.costAmountPaise; // LABOUR, HALT and OTHER all land here — the response has no separate column for them.
      chargeBuckets.set(c.tripId, acc);
    }

    // A branch already in scope (forced or requested) breaks down by time
    // period instead — one row per branch would be a single, redundant row.
    type Acc = {
      period: string;
      placementPaise: number;
      loadingPaise: number;
      unloadingPaise: number;
      detentionPaise: number;
      otherPaise: number;
      revenuePaise: number;
    };
    const groups = new Map<string, Acc>();
    for (const t of trips) {
      const key = branchId ? periodKey(String(t.deliveredAt), query.granularity) : t.branchName;
      const c = chargeBuckets.get(t.id) ?? { loading: 0, unloading: 0, detention: 0, other: 0 };
      const acc = groups.get(key) ?? {
        period: key,
        placementPaise: 0,
        loadingPaise: 0,
        unloadingPaise: 0,
        detentionPaise: 0,
        otherPaise: 0,
        revenuePaise: 0,
      };
      acc.placementPaise += t.placementPaise;
      acc.loadingPaise += c.loading;
      acc.unloadingPaise += c.unloading;
      acc.detentionPaise += c.detention;
      acc.otherPaise += c.other;
      acc.revenuePaise += t.revenuePaise;
      groups.set(key, acc);
    }

    const rows = [...groups.values()]
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((r) => {
        const costPaise = r.placementPaise + r.loadingPaise + r.unloadingPaise + r.detentionPaise + r.otherPaise;
        return { ...r, costPaise, marginPaise: r.revenuePaise - costPaise };
      });

    const scope = await this.describeScope(branchId, forcedBranchId !== null);
    return { scope, rows };
  }

  async exceptions(user: AuthenticatedUser) {
    const canViewAll = (user.permissions.get('pnl.view_all') ?? 'NONE') !== 'NONE';
    const canViewOwn = (user.permissions.get('pnl.view_own') ?? 'NONE') !== 'NONE';
    if (!canViewAll && !canViewOwn) {
      throw new DomainException(403, 'PERMISSION_DENIED', 'Missing permission: pnl.view_all or pnl.view_own.');
    }
    const branchId = !canViewAll ? (user.branch?.id ?? null) : null;
    return this.pnlRepository.closedTripsWithNoCharges(branchId);
  }

  private async describeScope(branchId: string | null, forced: boolean): Promise<string> {
    if (!branchId) return 'All branches';
    const branch = await this.pnlRepository.branchName(branchId);
    const name = branch?.name ?? 'Your branch';
    return forced ? `${name} only · pnl.view_all not granted` : `${name} only`;
  }
}

/** No explicit range → the current month, same default as GET /reports/home. */
function resolveRange(from: string | undefined, to: string | undefined): { from: string; to: string } {
  if (from && to) return { from, to };
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

function periodKey(deliveredAtIso: string, granularity: string | undefined): string {
  const d = new Date(deliveredAtIso);
  if (granularity === 'DAILY') return d.toISOString().slice(0, 10);
  if (granularity === 'QUARTERLY') return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
  return d.toISOString().slice(0, 7); // MONTHLY, the default.
}
