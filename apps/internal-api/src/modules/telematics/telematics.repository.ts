import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';
import { OPEN_TRIP_STAGES } from './telematics.constants';

@Injectable()
export class TelematicsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  /** Ping acceptance gate — part 11 §2: "a vehicle_no not on any open trip" is rejected. */
  findOpenTripByVehicleNo(vehicleNo: string) {
    return this.db
      .selectFrom('trips')
      .select(['id', 'code', 'eway_valid_till as ewayValidTill'])
      .where('vehicle_no', '=', vehicleNo)
      .where('stage', 'in', [...OPEN_TRIP_STAGES])
      .executeTakeFirst();
  }

  insertPing(row: { vehicleNo: string; at: string; lat: number | null; lng: number | null; speedKmph: number | null; fuelPct: number | null; raw: unknown }) {
    return this.db
      .insertInto('telematics_pings')
      .values({
        vehicle_no: row.vehicleNo,
        at: row.at,
        lat: row.lat === null ? null : String(row.lat),
        lng: row.lng === null ? null : String(row.lng),
        speed: row.speedKmph,
        fuel: row.fuelPct,
        raw: row.raw as never,
      })
      .execute();
  }

  latestPing(vehicleNo: string) {
    return this.db
      .selectFrom('telematics_pings')
      .selectAll()
      .where('vehicle_no', '=', vehicleNo)
      .orderBy('at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /** Every ping in the window, newest first — halt/dark-vehicle derivation needs the whole run, not just the latest. */
  recentPings(vehicleNo: string, sinceIso: string) {
    return this.db
      .selectFrom('telematics_pings')
      .selectAll()
      .where('vehicle_no', '=', vehicleNo)
      .where('at', '>=', sinceIso)
      .orderBy('at', 'desc')
      .execute();
  }

  /** Open trips with a vehicle assigned — the board's candidate rows before ping data joins in. */
  openTripsWithVehicle() {
    return this.db
      .selectFrom('trips')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .select([
        'trips.id as tripId',
        'trips.code as tripCode',
        'trips.vehicle_no as vehicleNo',
        'trips.lane as lane',
        'trips.eway_valid_till as ewayValidTill',
        'trips.created_at as tripCreatedAt',
        'trips.transit_days_required as transitDaysRequired',
        'vendors.legal_name as vendorName',
      ])
      .where('trips.stage', 'in', [...OPEN_TRIP_STAGES])
      .where('trips.vehicle_no', 'is not', null)
      .execute();
  }

  activeAlerts(vehicleNo: string) {
    return this.db
      .selectFrom('telematics_alerts')
      .select(['id', 'kind'])
      .where('vehicle_no', '=', vehicleNo)
      .where('cleared_at', 'is', null)
      .execute();
  }

  raiseAlert(vehicleNo: string, tripId: string | null, kind: string) {
    return this.db
      .insertInto('telematics_alerts')
      .values({ vehicle_no: vehicleNo, trip_id: tripId, kind })
      .execute();
  }

  clearAlert(id: string) {
    return this.db
      .updateTable('telematics_alerts')
      .set({ cleared_at: new Date().toISOString() })
      .where('id', '=', id)
      .execute();
  }
}
