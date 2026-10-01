import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { BandPosition } from '../../common/band-position';

export interface IndentListFilters {
  stage?: string;
  branchId?: string;
  clientId?: string;
}

@Injectable()
export class IndentsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  /** The agreed rate card lane an indent names, for cross-verification. */
  findRateCardLane(laneId: string) {
    return this.db
      .selectFrom('rate_card_lanes')
      .select([
        'id',
        'client_id as clientId',
        'origin',
        'destination',
        'truck_type as truckType',
        'rate as ratePaise',
        'rate_basis as rateBasis',
        'valid_from as validFrom',
        'valid_to as validTo',
      ])
      .where('id', '=', laneId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  }

  /**
   * The bid band an indent inherits: the client's lane in force on the pickup
   * date for this route and truck. Matched by route rather than by an id the
   * form would have to carry, so the band follows the lane even when the
   * person typed the route instead of picking it from the rate card.
   */
  findLaneBandForRoute(
    clientId: string,
    fromCity: string,
    toCity: string,
    truckType: string,
    pickupDate: string,
  ) {
    return this.db
      .selectFrom('rate_card_lanes')
      .select(['bid_min as bidMin', 'bid_max as bidMax'])
      .where('client_id', '=', clientId)
      .where('deleted_at', 'is', null)
      .where(sql<boolean>`lower(origin) = lower(${fromCity})`)
      .where(sql<boolean>`lower(destination) = lower(${toCity})`)
      .where(sql<boolean>`lower(truck_type) = lower(${truckType})`)
      .where('valid_from', '<=', pickupDate)
      .where((eb) => eb.or([eb('valid_to', 'is', null), eb('valid_to', '>=', pickupDate)]))
      .orderBy('valid_from', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

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

  /**
   * Joins the two names the detail screen shows in its header, which `list()`
   * has always joined and this did not — so the load-request detail page
   * rendered a blank Client and Branch against the real API while looking
   * correct in the fixture, which carries the names inline.
   *
   * `selectAll('indents')` keeps every column in its own snake_case shape, so
   * the existing mappers are untouched; the two aliases are additive. An inner
   * join is safe here: `client_id` and `branch_id` are both NOT NULL.
   */
  findById(id: string) {
    return this.db
      .selectFrom('indents')
      .innerJoin('clients', 'clients.id', 'indents.client_id')
      .innerJoin('branches', 'branches.id', 'indents.branch_id')
      .selectAll('indents')
      .select(['clients.name as clientName', 'branches.name as branchName'])
      .where('indents.id', '=', id)
      .executeTakeFirst();
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
      // An award now generates its trip at once (stage TRIP_CREATED), so "awarded
      // but no truck ever named" is TRIP_CREATED with no vehicle on the indent.
      .where((eb) =>
        eb.or([
          eb('stage', 'in', ['OPEN', 'VENDOR_ASSIGNED']),
          eb.and([eb('stage', '=', 'TRIP_CREATED'), eb('vehicle_no', 'is', null)]),
        ]),
      )
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
      pickup_address?: string | null;
      drop_address?: string | null;
      rate_source: string;
      sell_rate: number;
      sourcing_rate: number | null;
      spot_confirmation_attachment_id: string | null;
      rate_card_lane_id: string | null;
      bid_min: number | null;
      bid_max: number | null;
      band_locked: boolean;
      advance_pct: number;
      advance_pct_overridden: boolean;
    },
  ) {
    const values = { code, ...row };
    return db.insertInto('indents').values(values).returningAll().executeTakeFirstOrThrow();
  }

  /**
   * Indents nobody has touched for `days` days that are still waiting on somebody:
   * not yet awarded, or awarded with the truck still to load. A review ("keep")
   * counts as a touch, so a kept indent leaves the list until it has been quiet
   * for another week.
   */
  listStale(days: number, branchId?: string) {
    let query = this.db
      .selectFrom('indents')
      .innerJoin('clients', 'clients.id', 'indents.client_id')
      .select([
        'indents.id as id',
        'indents.code as code',
        'clients.name as clientName',
        'indents.from_city as fromCity',
        'indents.to_city as toCity',
        'indents.stage as stage',
        'indents.pickup_date as pickupDate',
        'indents.updated_at as updatedAt',
        'indents.last_reviewed_at as lastReviewedAt',
      ])
      .where('indents.stage', 'in', ['OPEN', 'VENDOR_ASSIGNED', 'VEHICLE_PLACED', 'TRIP_CREATED'])
      .where(
        sql<boolean>`greatest(indents.updated_at, coalesce(indents.last_reviewed_at, indents.updated_at)) < now() - make_interval(days => ${days})`,
      );
    if (branchId) query = query.where('indents.branch_id', '=', branchId);
    return query.orderBy('indents.updated_at').execute();
  }

  findTripByIndent(indentId: string) {
    return this.db.selectFrom('trips').select(['id', 'code']).where('indent_id', '=', indentId).executeTakeFirst();
  }

  findQuoteByVendor(db: DbExecutor, indentId: string, vendorId: string) {
    return db
      .selectFrom('quotes')
      .select(['id', 'status'])
      .where('indent_id', '=', indentId)
      .where('vendor_id', '=', vendorId)
      .executeTakeFirst();
  }

  insertQuote(
    db: DbExecutor,
    row: {
      code: string;
      indentId: string;
      vendorId: string;
      amountPaise: number;
      truckRegistration: string | null;
      remarks: string | null;
      bandPosition: BandPosition;
    },
  ) {
    return db
      .insertInto('quotes')
      .values({
        code: row.code,
        indent_id: row.indentId,
        vendor_id: row.vendorId,
        amount: row.amountPaise,
        truck_registration: row.truckRegistration,
        remarks: row.remarks,
        band_position: row.bandPosition,
        status: 'SUBMITTED',
      })
      .returning(['id', 'code'])
      .executeTakeFirstOrThrow();
  }

  update(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('indents').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
}
