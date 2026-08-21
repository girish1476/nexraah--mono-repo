import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';

@Injectable()
export class PnlRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  /** Delivered trips in `[from, to)` — placement rate and the client's freight, the two per-trip anchors. */
  tripsInRange(branchId: string | null, from: string, to: string) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .select([
        'trips.id as id',
        'trips.branch_id as branchId',
        'branches.name as branchName',
        'trips.delivered_at as deliveredAt',
        'trips.buy_rate as placementPaise',
        'indents.sell_rate as revenuePaise',
      ])
      .where('trips.delivered_at', 'is not', null)
      .where('trips.delivered_at', '>=', from)
      .where('trips.delivered_at', '<', to);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.execute();
  }

  /** Every charge line on those same trips — BR-45, cost only, never billed_amount. */
  chargesInRange(branchId: string | null, from: string, to: string) {
    let query = this.db
      .selectFrom('trip_charges')
      .innerJoin('trips', 'trips.id', 'trip_charges.trip_id')
      .select([
        'trip_charges.trip_id as tripId',
        'trip_charges.charge_type as chargeType',
        'trip_charges.cost_amount as costAmountPaise',
      ])
      .where('trips.delivered_at', 'is not', null)
      .where('trips.delivered_at', '>=', from)
      .where('trips.delivered_at', '<', to);
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.execute();
  }

  /** `stage = CLOSED` with zero rows in `trip_charges` — R-01, overstated margin nothing else surfaces. */
  closedTripsWithNoCharges(branchId: string | null) {
    let query = this.db
      .selectFrom('trips')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .innerJoin('branches', 'branches.id', 'trips.branch_id')
      .select([
        'trips.id as tripId',
        'trips.code as tripCode',
        'trips.lane as lane',
        'vendors.legal_name as vendorName',
        'branches.name as branchName',
        'trips.delivered_at as deliveredAt',
        'trips.buy_rate as buyRatePaise',
      ])
      .where('trips.stage', '=', 'CLOSED')
      .where((eb) =>
        eb.not(
          eb.exists(eb.selectFrom('trip_charges').whereRef('trip_charges.trip_id', '=', 'trips.id').select('trip_id')),
        ),
      );
    if (branchId) query = query.where('trips.branch_id', '=', branchId);
    return query.orderBy('trips.delivered_at', 'desc').execute();
  }

  branchName(branchId: string) {
    return this.db.selectFrom('branches').select('name').where('id', '=', branchId).executeTakeFirst();
  }
}
