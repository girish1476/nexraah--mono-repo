import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { MarketGapRepository } from './market-gap.repository';

@Injectable()
export class MarketGapService {
  constructor(private readonly marketGapRepository: MarketGapRepository) {}

  // Scoped to the caller's own branch when they have one — a user without a
  // branch sees every branch's gap. Keyed on the user, not on a role.
  async list(actor: AuthenticatedUser) {
    const branchId = actor.branch?.id ?? undefined;
    const rows = await this.marketGapRepository.list(branchId);
    return rows.map((r) => this.toRow(r));
  }

  /**
   * Answers with the full computed row, the same shape as `list()`. The screen
   * replaces the row it has with whatever comes back, so the earlier
   * `{ id, target }` blanked lane, branch and progress on every edit — only
   * against the real API, since the mock echoed the whole row.
   */
  async updateTarget(id: string, target: number) {
    const existing = await this.marketGapRepository.findById(id);
    if (!existing) throw new DomainException(404, 'NOT_FOUND', `Unknown market-gap row: ${id}`);
    await this.marketGapRepository.updateTarget(id, target);
    const row = await this.marketGapRepository.findRow(id);
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown market-gap row: ${id}`);
    return this.toRow(row);
  }

  // gap/progressPct are computed server-side (docs/api/02) — the screen
  // never derives them.
  private toRow(r: {
    id: string;
    branchId: string;
    branchName: string;
    lane: string;
    truckType: string;
    target: number;
    onPanel: number;
    converted: number;
  }) {
    const gap = Math.max(0, r.target - r.onPanel);
    const progressPct = r.target > 0 ? Math.round((r.converted / r.target) * 1000) / 10 : 0;
    return {
      id: r.id,
      branchId: r.branchId,
      branchName: r.branchName,
      lane: r.lane,
      truckType: r.truckType,
      target: r.target,
      onPanel: r.onPanel,
      converted: r.converted,
      gap,
      progressPct,
    };
  }
}
