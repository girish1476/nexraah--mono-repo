import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';

@Injectable()
export class MarketGapRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  private rowQuery() {
    return this.db
      .selectFrom('market_gap_targets')
      .innerJoin('branches', 'branches.id', 'market_gap_targets.branch_id')
      .select([
        'market_gap_targets.id as id',
        'market_gap_targets.branch_id as branchId',
        'branches.name as branchName',
        'market_gap_targets.lane as lane',
        'market_gap_targets.truck_type as truckType',
        'market_gap_targets.target as target',
        'market_gap_targets.on_panel as onPanel',
        'market_gap_targets.converted as converted',
      ]);
  }

  list(branchId?: string) {
    let query = this.rowQuery().orderBy('branches.name').orderBy('market_gap_targets.lane');
    if (branchId) query = query.where('market_gap_targets.branch_id', '=', branchId);
    return query.execute();
  }

  /** Same shape as `list()` for one row — what a write hands back. */
  findRow(id: string) {
    return this.rowQuery().where('market_gap_targets.id', '=', id).executeTakeFirst();
  }

  findById(id: string) {
    return this.db.selectFrom('market_gap_targets').selectAll().where('id', '=', id).executeTakeFirst();
  }

  updateTarget(id: string, target: number) {
    return this.db
      .updateTable('market_gap_targets')
      .set({ target })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
