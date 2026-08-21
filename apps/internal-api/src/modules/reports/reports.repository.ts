import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';

@Injectable()
export class ReportsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  /** Open indents — the pending-allocation queue. `branchId` scopes BRANCH_MGR (part 09). */
  openIndents(branchId: string | null) {
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
        'indents.weight_kg as weightKg',
        'indents.truck_type as truckType',
        'indents.pickup_date as pickupDate',
        'indents.sell_rate as sellRatePaise',
        'branches.name as branchName',
        eb
          .selectFrom('quotes')
          .select((e) => e.fn.countAll<number>().as('c'))
          .whereRef('quotes.indent_id', '=', 'indents.id')
          .as('quoteCount'),
      ])
      .where('indents.stage', '=', 'OPEN');
    if (branchId) query = query.where('indents.branch_id', '=', branchId);
    return query.orderBy('indents.pickup_date', 'asc').execute();
  }

  /** `stage IN (OPEN, VENDOR_ASSIGNED) AND pickup_date < today` — BR-18 placement failures. */
  placementFailures(branchId: string | null) {
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
        'indents.pickup_date as pickupDate',
        'indents.sell_rate as sellRatePaise',
        'branches.name as branchName',
        'indents.failure_cause as failureCause',
        eb
          .selectFrom('quotes')
          .select((e) => e.fn.countAll<number>().as('c'))
          .whereRef('quotes.indent_id', '=', 'indents.id')
          .as('quoteCount'),
      ])
      .where('indents.stage', 'in', ['OPEN', 'VENDOR_ASSIGNED'])
      .where('indents.pickup_date', '<', sql<string>`current_date`);
    if (branchId) query = query.where('indents.branch_id', '=', branchId);
    return query.orderBy('indents.pickup_date', 'asc').execute();
  }

  /** Open vendor issues — same join/mapping as IssuesRepository.list(), filtered to unresolved. */
  openVendorIssues() {
    return this.db
      .selectFrom('issues')
      .innerJoin('vendors', 'vendors.id', 'issues.vendor_id')
      .innerJoin('users', 'users.id', 'issues.raised_by')
      .leftJoin('trips', 'trips.id', 'issues.trip_id')
      .select([
        'issues.id as id',
        'issues.code as code',
        'issues.vendor_id as vendorId',
        'vendors.legal_name as vendorName',
        'issues.category as category',
        'issues.severity as severity',
        'trips.code as tripCode',
        'users.name as raisedBy',
        'issues.raised_at as raisedAt',
        'issues.status as status',
        'issues.note as note',
      ])
      .where('issues.status', '!=', 'RESOLVED')
      .orderBy('issues.raised_at', 'desc')
      .execute();
  }

  /** Delivered trips whose POD hasn't reached an accepted terminal state. */
  podOverdue(branchId: string | null) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .select([
        'trips.id as tripId',
        'trips.code as tripCode',
        'trips.lane as lane',
        'vendors.legal_name as vendorName',
        'trips.delivered_at as deliveredAt',
        'trips.buy_rate as buyRatePaise',
        'trips.advance_paid as advancePaidPaise',
      ])
      .where('trips.delivered_at', 'is not', null)
      .where('trips.pod_status', 'not in', ['APPROVED', 'WAIVED']);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.orderBy('trips.delivered_at', 'asc').execute();
  }

  // ---- Home — part 09 §2, reporting not operations ------------------------

  /** Trips delivered within [monthStart, monthEnd) — the basis for revenue, margin, POD and branch/client breakdowns. */
  homeTrips(branchId: string | null, monthStart: string, monthEnd: string) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .innerJoin('clients', 'clients.id', 'indents.client_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .select((eb) => [
        'trips.id as id',
        'trips.vendor_id as vendorId',
        'trips.vehicle_no as vehicleNo',
        'trips.branch_id as branchId',
        'branches.name as branchName',
        'clients.id as clientId',
        'clients.name as clientName',
        'trips.buy_rate as buyRatePaise',
        'indents.sell_rate as sellRatePaise',
        'trips.transit_days_required as transitDaysRequired',
        'trips.actual_transit_days as actualTransitDays',
        'trips.delivered_at as deliveredAt',
        'trips.pod_status as podStatus',
        'trips.pod_received_at as podReceivedAt',
        'trips.pod_penalty as podPenaltyPaise',
        eb
          .selectFrom('trip_charges')
          .select((e) => e.fn.coalesce(e.fn.sum<number>('cost_amount'), sql<number>`0`).as('c'))
          .whereRef('trip_charges.trip_id', '=', 'trips.id')
          .as('chargeCostPaise'),
      ])
      .where('trips.delivered_at', '>=', monthStart)
      .where('trips.delivered_at', '<', monthEnd);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.execute();
  }

  /** Indents due to pick up in the month that never got a vehicle placed (BR-18, same failure_cause as Today). */
  homeFailureCount(branchId: string | null, monthStart: string, monthEnd: string) {
    let query = this.db
      .selectFrom('indents')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('indents.pickup_date', '>=', monthStart)
      .where('indents.pickup_date', '<', monthEnd)
      .where('indents.failure_cause', 'is not', null);
    if (branchId) query = query.where('indents.branch_id', '=', branchId);
    return query.executeTakeFirstOrThrow();
  }

  /** Indents due to pick up in the month whose vehicle was placed (stage reached VEHICLE_PLACED or later). */
  homePlacedByPickupCount(branchId: string | null, monthStart: string, monthEnd: string) {
    let query = this.db
      .selectFrom('indents')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('indents.pickup_date', '>=', monthStart)
      .where('indents.pickup_date', '<', monthEnd)
      .where('indents.stage', 'in', ['VEHICLE_PLACED', 'TRIP_CREATED']);
    if (branchId) query = query.where('indents.branch_id', '=', branchId);
    return query.executeTakeFirstOrThrow();
  }

  /** Advance owed and not yet released — `gross = buy_rate × advance_pct / 100` (docs/api/06-payments.md). */
  advanceOutstanding(branchId: string | null) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .select((eb) =>
        eb.fn
          .coalesce(
            eb.fn.sum<number>(sql<number>`trips.buy_rate * indents.advance_pct / 100`),
            sql<number>`0`,
          )
          .as('total'),
      )
      .where('trips.advance_paid', '=', 0);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.executeTakeFirstOrThrow();
  }

  /** Delivered trips with money still owed on the balance leg. */
  balancePending(branchId: string | null) {
    let query = this.db
      .selectFrom('trips')
      .select((eb) =>
        eb.fn
          .coalesce(
            eb.fn.sum<number>(sql<number>`trips.buy_rate - trips.advance_paid - trips.pod_penalty - trips.balance_paid`),
            sql<number>`0`,
          )
          .as('total'),
      )
      .where('trips.stage', '=', 'DELIVERED')
      .where('trips.balance_paid', '=', 0);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.executeTakeFirstOrThrow();
  }

  /**
   * Issued/part-paid invoices not yet fully collected. Invoices carry no
   * branch_id (one invoice can span trips from more than one branch), so a
   * BRANCH_MGR's figure is approximated via "touches at least one of their
   * trips" rather than split proportionally.
   */
  receivables(branchId: string | null) {
    let query = this.db
      .selectFrom('invoices')
      .select((eb) =>
        eb.fn.coalesce(eb.fn.sum<number>(sql<number>`invoices.total - invoices.received`), sql<number>`0`).as('total'),
      )
      .where('invoices.status', 'in', ['ISSUED', 'PART_PAID']);
    if (branchId) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('invoice_trips')
            .innerJoin('trips', 'trips.id', 'invoice_trips.trip_id')
            .whereRef('invoice_trips.invoice_id', '=', 'invoices.id')
            .where('trips.branch_id', '=', branchId)
            .select('invoice_trips.invoice_id'),
        ),
      );
    }
    return query.executeTakeFirstOrThrow();
  }

  /** POD-approved trips with no invoice yet (`invoice_trips` is where a trip is billed once). */
  unbilledTripsCount(branchId: string | null) {
    let query = this.db
      .selectFrom('trips')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('trips.pod_status', '=', 'APPROVED')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb.selectFrom('invoice_trips').whereRef('invoice_trips.trip_id', '=', 'trips.id').select('trip_id'),
          ),
        ),
      );
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.executeTakeFirstOrThrow();
  }

  /** `config.pod_tat_days` — BR-12, read fresh rather than duplicating the constant. */
  async podTatDays(): Promise<number> {
    const row = await this.db
      .selectFrom('config')
      .select('value')
      .where('key', '=', 'pod_tat_days')
      .executeTakeFirst();
    return typeof row?.value === 'number' ? row.value : 20;
  }
}
