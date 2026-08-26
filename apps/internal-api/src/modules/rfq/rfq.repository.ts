import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { SupplySourceCode } from '../branches/branches.constants';

export interface RfqListFilters {
  status?: string;
  clientId?: string;
}

@Injectable()
export class RfqRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  // ---- List / stats -------------------------------------------------------

  /**
   * `rfqs`/`rfq_lanes` carry no `branch_id` column — branch-scoping this list
   * is not mechanically possible without a schema change, so this
   * intentionally returns every RFQ regardless of the caller's branch.
   */
  list(filters: RfqListFilters) {
    let query = this.db
      .selectFrom('rfqs')
      .innerJoin('clients', 'clients.id', 'rfqs.client_id')
      .leftJoin('rfq_lanes', 'rfq_lanes.rfq_id', 'rfqs.id')
      .select((eb) => [
        'rfqs.id as id',
        'clients.name as clientName',
        'rfqs.reference as reference',
        'rfqs.cycle_months as cycleMonths',
        'rfqs.period_from as periodFrom',
        'rfqs.period_to as periodTo',
        'rfqs.due_at as dueAt',
        'rfqs.status as status',
        eb.fn.count<number>('rfq_lanes.id').as('laneCount'),
      ])
      .groupBy([
        'rfqs.id',
        'clients.name',
        'rfqs.reference',
        'rfqs.cycle_months',
        'rfqs.period_from',
        'rfqs.period_to',
        'rfqs.due_at',
        'rfqs.status',
      ]);
    if (filters.status) query = query.where('rfqs.status', '=', filters.status);
    if (filters.clientId) query = query.where('rfqs.client_id', '=', filters.clientId);
    return query.orderBy('rfqs.created_at', 'desc').execute();
  }

  /** Unfiltered by design — the stat strip always reflects the whole book, matching the mock. */
  async stats() {
    const [open, laneAgg] = await Promise.all([
      this.db
        .selectFrom('rfqs')
        .select((eb) => eb.fn.count<number>('id').as('count'))
        .where('status', 'not in', ['CLOSED', 'LOST'])
        .executeTakeFirstOrThrow(),
      this.db
        .selectFrom('rfq_lanes')
        .select((eb) => [
          eb.fn.count<number>('id').as('lanesOut'),
          eb.fn
            .count<number>('id')
            .filterWhere('outcome', '=', 'WON')
            .as('lanesWon'),
          eb.fn
            .count<number>('id')
            .filterWhere('outcome', '=', 'LOST')
            .as('lanesLost'),
          eb.fn
            .sum<number>('awarded_rate')
            .filterWhere('outcome', '=', 'WON')
            .as('valueWon'),
        ])
        .executeTakeFirstOrThrow(),
    ]);
    return {
      open: Number(open.count),
      lanesOut: Number(laneAgg.lanesOut),
      lanesWon: Number(laneAgg.lanesWon),
      lanesLost: Number(laneAgg.lanesLost),
      valueWonPaise: Number(laneAgg.valueWon ?? 0),
    };
  }

  // ---- RFQ ------------------------------------------------------------------

  findById(id: string) {
    return this.db
      .selectFrom('rfqs')
      .innerJoin('clients', 'clients.id', 'rfqs.client_id')
      .select([
        'rfqs.id as id',
        'rfqs.client_id as clientId',
        'clients.name as clientName',
        'rfqs.cycle_months as cycleMonths',
        'rfqs.period_from as periodFrom',
        'rfqs.period_to as periodTo',
        'rfqs.due_at as dueAt',
        'rfqs.reference as reference',
        'rfqs.status as status',
        'rfqs.submitted_by as submittedBy',
        'rfqs.submitted_at as submittedAt',
      ])
      .where('rfqs.id', '=', id)
      .executeTakeFirst();
  }

  findByIdForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('rfqs').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  findClientById(id: string) {
    return this.db.selectFrom('clients').selectAll().where('id', '=', id).executeTakeFirst();
  }

  insertRfq(
    db: DbExecutor,
    row: {
      id: string;
      client_id: string;
      cycle_months: number;
      period_from: string;
      period_to: string;
      due_at: string | null;
      reference: string | null;
    },
  ) {
    return db.insertInto('rfqs').values({ ...row, status: 'DRAFT' }).returningAll().executeTakeFirstOrThrow();
  }

  updateRfq(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('rfqs').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }

  // ---- Lanes ----------------------------------------------------------------

  findLanesForRfq(rfqId: string) {
    return this.db.selectFrom('rfq_lanes').selectAll().where('rfq_id', '=', rfqId).orderBy('created_at').execute();
  }

  findLaneForUpdate(db: DbExecutor, laneId: string) {
    return db.selectFrom('rfq_lanes').selectAll().where('id', '=', laneId).forUpdate().executeTakeFirst();
  }

  insertLane(
    db: DbExecutor,
    row: {
      id: string;
      rfq_id: string;
      origin: string;
      destination: string;
      truck_type: string;
      transit_days: number;
      reporting_rule: string;
    },
  ) {
    return db
      .insertInto('rfq_lanes')
      .values({
        ...row,
        sourcing_mode: null,
        sourcing_avg: null,
        overhead: null,
        margin: null,
        quoted_rate: null,
        outcome: null,
        awarded_rate: null,
        // Not known at lane creation — sourcing fills it in (BR-36 flow).
        supply_source: null,
        supply_remarks: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  updateLane(db: DbExecutor, laneId: string, patch: Record<string, unknown>) {
    return db.updateTable('rfq_lanes').set(patch).where('id', '=', laneId).returningAll().executeTakeFirstOrThrow();
  }

  // ---- Sourcing rows ----------------------------------------------------------

  findSourcingForLanes(laneIds: string[]) {
    if (laneIds.length === 0) return Promise.resolve([]);
    return this.db
      .selectFrom('rfq_lane_sourcing')
      .select(['id', 'rfq_lane_id', 'month', 'rate'])
      .where('rfq_lane_id', 'in', laneIds)
      .orderBy('month')
      .execute();
  }

  replaceSourcing(db: DbExecutor, laneId: string, rows: { month: string | null; rate: number }[]) {
    return db
      .deleteFrom('rfq_lane_sourcing')
      .where('rfq_lane_id', '=', laneId)
      .execute()
      .then(() => {
        if (rows.length === 0) return undefined;
        return db
          .insertInto('rfq_lane_sourcing')
          .values(rows.map((r) => ({ rfq_lane_id: laneId, month: r.month, rate: r.rate })))
          .execute();
      });
  }

  // ---- Rate card --------------------------------------------------------------

  insertRateCardLane(
    db: DbExecutor,
    row: {
      id: string;
      client_id: string;
      rfq_lane_id: string;
      origin: string;
      destination: string;
      truck_type: string;
      rate: number;
      transit_days: number | null;
      reporting_rule: string | null;
      valid_from: string;
      valid_to: string | null;
      supply_source: SupplySourceCode | null;
      supply_remarks: string | null;
    },
  ) {
    return db.insertInto('rate_card_lanes').values(row).returningAll().executeTakeFirstOrThrow();
  }
}
