import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { TargetMetric } from './target-rules';

/** Every range here is `[from, to)` on dates — the first of a month to the first of a later one. */
@Injectable()
export class TargetsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  /** Targets summed per measure over the range — one branch's, or every branch's when unscoped. */
  totals(branchId: string | null, from: string, to: string) {
    let query = this.db
      .selectFrom('branch_targets')
      .select((eb) => ['metric', eb.fn.sum<number>('target').as('total')])
      .where('month', '>=', from)
      .where('month', '<', to);
    if (branchId) query = query.where('branch_id', '=', branchId);
    return query.groupBy('metric').execute();
  }

  /** Every target set for one month, for the screen an administrator enters them on. */
  forMonth(month: string) {
    return this.db
      .selectFrom('branch_targets')
      .select(['branch_id as branchId', 'metric', 'target'])
      .where('month', '=', month)
      .execute();
  }

  branches() {
    return this.db.selectFrom('branches').select(['id', 'name']).orderBy('name').execute();
  }

  set(db: DbExecutor, row: { branchId: string; month: string; metric: TargetMetric; target: number; setBy: string }) {
    return db
      .insertInto('branch_targets')
      .values({
        branch_id: row.branchId,
        month: row.month,
        metric: row.metric,
        target: row.target,
        set_by: row.setBy,
      })
      .onConflict((oc) =>
        oc.columns(['branch_id', 'month', 'metric']).doUpdateSet({
          target: row.target,
          set_by: row.setBy,
          updated_at: sql<string>`now()`,
        }),
      )
      .execute();
  }

  clear(db: DbExecutor, branchId: string, month: string, metric: TargetMetric) {
    return db
      .deleteFrom('branch_targets')
      .where('branch_id', '=', branchId)
      .where('month', '=', month)
      .where('metric', '=', metric)
      .execute();
  }

  /**
   * Loads delivered in the range, what they were billed at and what they cost
   * — the same basis as the Business snapshot (`ReportsRepository.homeTrips`):
   * a trip counts in the month it was delivered, and its cost is the buy rate
   * plus the charges captured against it.
   */
  delivered(branchId: string | null, from: string, to: string) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .select((eb) => [
        eb.fn.countAll<number>().as('loads'),
        eb.fn.coalesce(eb.fn.sum<number>('indents.sell_rate'), sql<number>`0`).as('revenue'),
        eb.fn
          .coalesce(
            eb.fn.sum<number>(sql<number>`
              trips.buy_rate
              + coalesce((select sum(tc.cost_amount) from trip_charges tc where tc.trip_id = trips.id), 0)
            `),
            sql<number>`0`,
          )
          .as('cost'),
      ])
      .where('trips.delivered_at', '>=', from)
      .where('trips.delivered_at', '<', to);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.executeTakeFirstOrThrow();
  }

  /**
   * Money received from clients in the range. A receipt carries no branch, so
   * a branch's figure is the receipts on bills that touch one of its trips —
   * the same reading `ReportsRepository.receivables` takes.
   */
  collected(branchId: string | null, from: string, to: string) {
    let query = this.db
      .selectFrom('receipts')
      .select((eb) => eb.fn.coalesce(eb.fn.sum<number>('receipts.amount'), sql<number>`0`).as('total'))
      .where('receipts.received_on', '>=', from)
      .where('receipts.received_on', '<', to);
    if (branchId) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('invoice_trips')
            .innerJoin('trips', 'trips.id', 'invoice_trips.trip_id')
            .whereRef('invoice_trips.invoice_id', '=', 'receipts.invoice_id')
            .where('trips.branch_id', '=', branchId)
            .select('invoice_trips.invoice_id'),
        ),
      );
    }
    return query.executeTakeFirstOrThrow();
  }

  /** Deliveries whose proof was approved in the range. A trip counts once, however many times its proof was re-sent. */
  podsApproved(branchId: string | null, from: string, to: string) {
    let query = this.db
      .selectFrom('pod_receipts')
      .innerJoin('trips', 'trips.id', 'pod_receipts.trip_id')
      .select(sql<number>`count(distinct pod_receipts.trip_id)`.as('c'))
      .where('pod_receipts.approved_at', '>=', from)
      .where('pod_receipts.approved_at', '<', to);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.executeTakeFirstOrThrow();
  }
}
