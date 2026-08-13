/** Telematics — part 11. */

export type AlertKind = 'OVERSPEED' | 'LONG_HALT' | 'DARK_VEHICLE' | 'EWAY_EXPIRING' | 'EWAY_EXPIRED';

export interface VehicleRow {
  vehicleNo: string;
  tripCode: string | null;
  vendorName: string;
  lane: string;
  progressPct: number;
  speedKmph: number;
  fuelPct: number;
  lastPingAt: string;
  lat: number;
  lng: number;
  ewayValidTill: string | null;
  alerts: AlertKind[];
}

export interface TelematicsResponse {
  /**
   * Thresholds from the control panel. Changing one re-evaluates the live
   * board immediately — it does not wait for the next ping (FSD A6).
   */
  config: { overspeedKmph: number; haltMinutes: number; darkVehicleIntervalMinutes: number };
  vehicles: VehicleRow[];
}
