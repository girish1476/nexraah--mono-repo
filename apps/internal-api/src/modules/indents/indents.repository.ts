import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

export interface IndentListFilters {
  stage?: string;
  branchId?: string;
  clientId?: string;
}

@Injectable()
export class IndentsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  /** Just the onboarding state — the indent guard needs nothing else. */
  findClientStatus(clientId: string) {
    return this.db
      .selectFrom('clients')
      .select(['id', 'status'])
      .where('id', '=', clientId)
      .executeTakeFirst();
  }

  transaction() {
    return this.db.transaction();
  }

  list(filters: IndentListFilters) {
    let query = this.db
      .selectFrom('indents')
      .innerJoin('clients', 'clients.id', 'indents.client_id')
      .innerJoin('branches', 'branches.id', 'indents.branch_id')
      .select((eb) => [
        'indents.id as id',
        'indents.code as code',
        'clients.name as clientName',
        'indents.from_city as fromCity',
        'indents.to_city as toCity',
        'indents.material as material',
        'indents.weight_kg as weightKg',
        'indents.truck_type as truckType',
        'indents.pickup_date as pickupDate',
        'indents.sell_rate as sellRatePaise',
        'indents.buy_rate as buyRatePaise',
        'indents.stage as stage',
        'branches.name as branchName',
        'indents.failure_cause as failureCause',
        eb
          .selectFrom('quotes')
          .select((e) => e.fn.countAll<number>().as('c'))
          .whereRef('quotes.indent_id', '=', 'indents.id')
          .as('quoteCount'),
      ]);

    if (filters.stage) query = query.where('indents.stage', 'in', filters.stage.split(','));
    if (filters.branchId) query = query.where('indents.branch_id', '=', filters.branchId);
    if (filters.clientId) query = query.where('indents.client_id', '=', filters.clientId);

    return query.orderBy('indents.pickup_date', 'desc').execute();
  }

  findById(id: string) {
    return this.db.selectFrom('indents').selectAll().where('id', '=', id).executeTakeFirst();
  }

  findByIdForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('indents').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  /**
   * `placement-failure` job's candidate set — `VENDOR_ASSIGNED` belongs here
   * alongside `OPEN`: an award that never reached `VEHICLE_PLACED` by
   * pickup day is a failure too (`TRUCK_NEVER_REPORTED`), not just an
   * indent nobody quoted. `failure_cause is null` so the sweep never
   * overwrites a cause someone (or a future desk-initiated cancel action)
   * already set by hand — `CLIENT_CANCELLED` has no backing column
   * anywhere in this schema, so it can only ever arrive that way.
   */
  dueForPlacementFailure() {
    return this.db
      .selectFrom('indents')
      .select(['id', 'stage', 'awarded_quote_id'])
      .where('stage', 'in', ['OPEN', 'VENDOR_ASSIGNED'])
      .where('pickup_date', '<', new Date().toISOString().slice(0, 10))
      .where('failure_cause', 'is', null)
      .execute();
  }

  findBranchByCity(city: string) {
    return this.db
      .selectFrom('branches')
      .selectAll()
      .where(sql`lower(city)`, '=', city.toLowerCase())
      .execute();
  }

  findQuotes(indentId: string) {
    return this.db
      .selectFrom('quotes')
      .innerJoin('vendors', 'vendors.id', 'quotes.vendor_id')
      .select([
        'quotes.id as id',
        'quotes.code as code',
        'quotes.vendor_id as vendorId',
        'vendors.legal_name as vendorName',
        'vendors.status as vendorStatus',
        'quotes.amount as amountPaise',
        'quotes.truck_registration as truckRegistration',
        'quotes.band_position as bandPosition',
        'quotes.status as status',
        'quotes.submitted_at as submittedAt',
        'quotes.remarks as remarks',
      ])
      .where('quotes.indent_id', '=', indentId)
      .orderBy('quotes.amount')
      .execute();
  }

  findQuoteForUpdate(db: DbExecutor, quoteId: string) {
    return db.selectFrom('quotes').selectAll().where('id', '=', quoteId).forUpdate().executeTakeFirst();
  }

  decideQuote(db: DbExecutor, quoteId: string, status: 'ACCEPTED' | 'REJECTED') {
    return db.updateTable('quotes').set({ status }).where('id', '=', quoteId).execute();
  }

  rejectOtherSubmittedQuotes(db: DbExecutor, indentId: string, exceptQuoteId: string) {
    return db
      .updateTable('quotes')
      .set({ status: 'REJECTED' })
      .where('indent_id', '=', indentId)
      .where('id', '!=', exceptQuoteId)
      .where('status', '=', 'SUBMITTED')
      .execute();
  }

  insert(
    db: DbExecutor,
    code: string,
    row: {
      client_id: string;
      branch_id: string;
      from_city: string;
      to_city: string;
      material: string;
      weight_kg: number;
      truck_type: string;
      pickup_date: string;
      transit_days: number | null;
      reporting_rule: string | null;
      remarks: string | null;
      rate_source: string;
      sell_rate: number;
      sourcing_rate: number | null;
      spot_confirmation_attachment_id: string | null;
      rate_card_lane_id: string | null;
      bid_min: number | null;
      bid_max: number | null;
      band_locked: boolean;
      advance_pct: number;
    },
  ) {
    const values = { code, ...row };
    return db.insertInto('indents').values(values).returningAll().executeTakeFirstOrThrow();
  }

  update(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('indents').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
}
