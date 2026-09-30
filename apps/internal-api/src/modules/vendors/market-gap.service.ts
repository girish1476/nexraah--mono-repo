import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { MarketGapRepository } from './market-gap.repository';
import type { CreateMarketGapDto, UpdateMarketGapDto } from './dto/update-market-gap.dto';

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
  async update(id: string, dto: UpdateMarketGapDto) {
    const existing = await this.marketGapRepository.findById(id);
    if (!existing) throw new DomainException(404, 'NOT_FOUND', `Unknown market-gap row: ${id}`);
    const patch = {
      ...(dto.target !== undefined ? { target: dto.target } : {}),
      ...(dto.onPanel !== undefined ? { on_panel: dto.onPanel } : {}),
      ...(dto.converted !== undefined ? { converted: dto.converted } : {}),
    };
    if (Object.keys(patch).length > 0) await this.marketGapRepository.update(id, patch);
    const row = await this.marketGapRepository.findRow(id);
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown market-gap row: ${id}`);
    return this.toRow(row);
  }

  /**
   * One row per branch, lane and truck type — the table's own unique key. A
   * second entry for the same three is refused by name rather than as a raw
   * duplicate-key error, so the person can edit the one already there.
   */
  async create(dto: CreateMarketGapDto, actor: AuthenticatedUser) {
    // A branch-scoped person records gaps for their own branch only.
    if (actor.branch && actor.branch.id !== dto.branchId) {
      throw new DomainException(403, 'WRONG_BRANCH', 'You can only record a gap for your own branch.');
    }
    const lane = dto.lane.trim();
    const truckType = dto.truckType.trim();
    const clash = await this.marketGapRepository.findByKey(dto.branchId, lane, truckType);
    if (clash) {
      throw new DomainException(409, 'MARKET_GAP_EXISTS', `${lane} · ${truckType} is already on the list for this branch — change its numbers there.`);
    }
    const inserted = await this.marketGapRepository.insert({
      branch_id: dto.branchId,
      lane,
      truck_type: truckType,
      target: dto.target,
      on_panel: dto.onPanel ?? 0,
      converted: dto.converted ?? 0,
    });
    const row = await this.marketGapRepository.findRow(inserted.id);
    if (!row) throw new DomainException(404, 'NOT_FOUND', `Unknown market-gap row: ${inserted.id}`);
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
