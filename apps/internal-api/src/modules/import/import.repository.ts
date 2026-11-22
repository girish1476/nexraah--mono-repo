import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { ImportSet } from './import.rules';
import { syntheticRfqPeriod } from '../clients/clients.repository';
import { branchServesCity } from '../branches/branch-city';

export interface BatchRow {
  id: string;
  set_name: ImportSet;
  file_name: string;
  file_hash: string;
  row_count: number;
  rejected_count: number;
  actor_id: string;
  actor_name: string;
  status: 'DRY_RUN' | 'COMMITTED' | 'ABORTED';
  report: unknown;
  payload: unknown;
  committed_at: string | null;
  created_at: string;
}

@Injectable()
export class ImportRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  /**
   * What already exists, for the ordering check in part 12 §4. Counting rather
   * than looking for a committed batch is deliberate: a database seeded by any
   * other route still satisfies the dependency, and the rule is about the data
   * being there, not about how it arrived.
   */
  /** The branches that serve a town — by their own city or the towns they list. */
  branchesServing(city: string) {
    return this.db.selectFrom('branches').select(['id', 'name']).where(branchServesCity(city)).execute();
  }

  async existingCounts(): Promise<{ clients: number; vendors: number }> {
    const [clients, vendors] = await Promise.all([
      this.db.selectFrom('clients').select(({ fn }) => fn.countAll<string>().as('n')).executeTakeFirst(),
      this.db.selectFrom('vendors').select(({ fn }) => fn.countAll<string>().as('n')).executeTakeFirst(),
    ]);
    return { clients: Number(clients?.n ?? 0), vendors: Number(vendors?.n ?? 0) };
  }

  insertBatch(db: DbExecutor, values: Record<string, unknown>) {
    return db
      .insertInto('import_batches')
      .values(values as never)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  findBatchForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('import_batches').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  markCommitted(db: DbExecutor, id: string) {
    return db
      .updateTable('import_batches')
      .set({ status: 'COMMITTED', committed_at: new Date().toISOString(), updated_at: new Date().toISOString() } as never)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  history() {
    return this.db
      .selectFrom('import_batches')
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(200)
      .execute();
  }

  /* ---- writes performed by a commit ------------------------------------ */

  insertClient(db: DbExecutor, values: Record<string, unknown>) {
    return db.insertInto('clients').values(values as never).returningAll().executeTakeFirstOrThrow();
  }

  insertVendor(db: DbExecutor, values: Record<string, unknown>) {
    return db.insertInto('vendors').values(values as never).returningAll().executeTakeFirstOrThrow();
  }

  /**
   * `rate_card_lanes.rfq_lane_id` is `NOT NULL` by schema, so an imported rate
   * needs a real lane to point at. Part 12 §1 calls for a synthetic **closed**
   * RFQ per client so `BR-37`'s provenance holds — the rate came from
   * somewhere identifiable, even when that somewhere is "the go-live file".
   */
  async syntheticRfqLane(
    db: DbExecutor,
    clientId: string,
    lane: { origin: string; destination: string; truckType: string; ratePaise: number },
    reference: string,
  ) {
    const existing = await db
      .selectFrom('rfqs')
      .select(['id'])
      .where('client_id', '=', clientId)
      .where('reference', '=', reference)
      .executeTakeFirst();

    const rfqId =
      existing?.id ??
      (
        await db
          .insertInto('rfqs')
          .values({
            client_id: clientId,
            cycle_months: 12,
            ...syntheticRfqPeriod(),
            reference,
            status: 'CLOSED',
          } as never)
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;

    return db
      .insertInto('rfq_lanes')
      .values({
        rfq_id: rfqId,
        origin: lane.origin,
        destination: lane.destination,
        truck_type: lane.truckType,
        quoted_rate: lane.ratePaise,
        awarded_rate: lane.ratePaise,
        outcome: 'WON',
      } as never)
      .returning('id')
      .executeTakeFirstOrThrow();
  }

  insertRateCardLane(db: DbExecutor, values: Record<string, unknown>) {
    return db.insertInto('rate_card_lanes').values(values as never).returningAll().executeTakeFirstOrThrow();
  }

  /* ---- opening balances --------------------------------------------------- */

  /** Client and transporter codes (upper case) → id, and the balances already carried in. */
  async balanceContext(): Promise<{ clients: Map<string, string>; vendors: Map<string, string>; existing: Set<string> }> {
    const [clients, vendors, existing] = await Promise.all([
      this.db.selectFrom('clients').select(['id', 'code']).execute(),
      this.db.selectFrom('vendors').select(['id', 'code']).execute(),
      this.db.selectFrom('opening_balances').select(['kind', 'reference']).execute(),
    ]);
    const byCode = (rows: { id: string; code: string }[]) =>
      new Map(rows.filter((r) => r.code).map((r) => [r.code.toUpperCase(), r.id]));
    return {
      clients: byCode(clients),
      vendors: byCode(vendors),
      existing: new Set(existing.map((r) => `${r.kind}:${r.reference.toUpperCase()}`)),
    };
  }

  insertOpeningBalance(db: DbExecutor, values: Record<string, unknown>) {
    return db.insertInto('opening_balances').values(values as never).returning('id').executeTakeFirstOrThrow();
  }

  listOpeningBalances() {
    return this.db
      .selectFrom('opening_balances as ob')
      .leftJoin('clients as c', 'c.id', 'ob.client_id')
      .leftJoin('vendors as v', 'v.id', 'ob.vendor_id')
      .leftJoin('users as u', 'u.id', 'ob.settled_by')
      .select([
        'ob.id',
        'ob.kind',
        'ob.reference',
        'ob.client_id',
        'ob.vendor_id',
        'ob.amount_paise',
        'ob.dated',
        'ob.status',
        'ob.settled_at',
        'ob.settled_note',
        'ob.batch_id',
        'c.name as client_name',
        'v.legal_name as vendor_name',
        'u.name as settled_by_name',
      ])
      .orderBy('ob.status', 'asc')
      .orderBy('ob.dated', 'asc')
      .execute();
  }

  findOpeningBalanceForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('opening_balances').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  settleOpeningBalance(db: DbExecutor, id: string, by: string, note: string) {
    return db
      .updateTable('opening_balances')
      .set({ status: 'SETTLED', settled_at: new Date().toISOString(), settled_by: by, settled_note: note })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
