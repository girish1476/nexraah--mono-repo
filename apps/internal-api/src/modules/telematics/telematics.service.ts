import { Injectable } from '@nestjs/common';
import { ConfigRepository } from '../config/config.repository';
import { DomainException } from '../../common/domain-exception';
import { TelematicsRepository } from './telematics.repository';
import { deriveAlerts, TelematicsThresholds } from './alert-rules';
import { AlertKind } from './telematics.constants';
import type { PingDto } from './dto/ping.dto';

@Injectable()
export class TelematicsService {
  constructor(
    private readonly repository: TelematicsRepository,
    private readonly configRepository: ConfigRepository,
  ) {}

  private async thresholds(): Promise<TelematicsThresholds> {
    const config = await this.configRepository.findAll();
    return {
      overspeedKmph: Number(config.get('overspeed_kmph') ?? 80),
      haltMinutes: Number(config.get('halt_minutes') ?? 90),
      darkVehicleIntervalMinutes: Number(config.get('dark_vehicle_interval_minutes') ?? 120),
      ewayWarningWindowHours: Number(config.get('eway_warning_window_hours') ?? 12),
    };
  }

  /**
   * `POST /telematics/ping` (guarded by `TelematicsHmacGuard`, no user
   * principal). Rejects a `vehicle_no` not on any open trip, records the
   * ping, then re-derives and reconciles alerts for that vehicle.
   */
  async ingestPing(dto: PingDto, rawBody: unknown): Promise<void> {
    const trip = await this.repository.findOpenTripByVehicleNo(dto.vehicleNo);
    if (!trip) {
      throw new DomainException(422, 'VEHICLE_NOT_ON_OPEN_TRIP', `${dto.vehicleNo} is not on any open trip.`);
    }

    await this.repository.insertPing({
      vehicleNo: dto.vehicleNo,
      at: dto.at,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      speedKmph: dto.speedKmph ?? null,
      fuelPct: dto.fuelPct ?? null,
      raw: rawBody,
    });

    await this.reconcileAlerts(dto.vehicleNo, trip.id, trip.ewayValidTill);
  }

  /** Re-derives alerts for one vehicle and reconciles them against what's currently open. */
  private async reconcileAlerts(vehicleNo: string, tripId: string | null, ewayValidTill: string | null): Promise<void> {
    const thresholds = await this.thresholds();
    const now = Date.now();
    const haltWindowStart = new Date(now - thresholds.haltMinutes * 60_000).toISOString();

    const [latest, pingsInHaltWindow, active] = await Promise.all([
      this.repository.latestPing(vehicleNo),
      this.repository.recentPings(vehicleNo, haltWindowStart),
      this.repository.activeAlerts(vehicleNo),
    ]);

    const wanted = new Set(
      deriveAlerts({
        now,
        latestPing: latest ? { at: latest.at, speedKmph: latest.speed } : undefined,
        pingsInHaltWindow: pingsInHaltWindow.map((p) => ({ at: p.at, speedKmph: p.speed })),
        ewayValidTill,
        thresholds,
      }),
    );

    const activeKinds = new Set(active.map((a) => a.kind));

    await Promise.all([
      ...active.filter((a) => !wanted.has(a.kind as AlertKind)).map((a) => this.repository.clearAlert(a.id)),
      ...[...wanted].filter((kind) => !activeKinds.has(kind)).map((kind) => this.repository.raiseAlert(vehicleNo, tripId, kind)),
    ]);
  }

  /** `GET /telematics` — the live board, part 11 §1. */
  async board() {
    const thresholds = await this.thresholds();
    const now = Date.now();
    const trips = await this.repository.openTripsWithVehicle();

    const vehicles = await Promise.all(
      trips
        .filter((t): t is typeof t & { vehicleNo: string } => !!t.vehicleNo)
        .map((t) => this.buildSnapshot(t, thresholds, now)),
    );

    return {
      config: {
        overspeedKmph: thresholds.overspeedKmph,
        haltMinutes: thresholds.haltMinutes,
        darkVehicleIntervalMinutes: thresholds.darkVehicleIntervalMinutes,
      },
      vehicles: vehicles.filter((v): v is NonNullable<typeof v> => v !== null),
    };
  }

  /**
   * `GET /telematics/vehicles/:vehicleNo` — tracking for one vehicle, for the
   * trip detail screen (part 05 §2 asked for this; the board alone left a
   * trip's own page with no link to what its vehicle is actually doing).
   * Same computation as one row of `board()`, so the two never drift apart.
   * `null` covers both "not on an open trip" and "no ping ever received" —
   * the caller decides how to word that, this just doesn't fabricate a row.
   */
  async forVehicle(vehicleNo: string) {
    const thresholds = await this.thresholds();
    const now = Date.now();
    const trips = await this.repository.openTripsWithVehicle();
    const trip = trips.find((t) => t.vehicleNo === vehicleNo);
    if (!trip) return null;
    return this.buildSnapshot(trip as typeof trip & { vehicleNo: string }, thresholds, now);
  }

  private async buildSnapshot(
    t: { vehicleNo: string; tripCode: string; vendorName: string; lane: string | null; ewayValidTill: string | null; tripCreatedAt: string; transitDaysRequired: number | null },
    thresholds: TelematicsThresholds,
    now: number,
  ) {
    const haltWindowStart = new Date(now - thresholds.haltMinutes * 60_000).toISOString();
    const [latest, pingsInHaltWindow] = await Promise.all([
      this.repository.latestPing(t.vehicleNo),
      this.repository.recentPings(t.vehicleNo, haltWindowStart),
    ]);
    if (!latest) return null; // no signal ever received — not shown, not fabricated

    const alerts = deriveAlerts({
      now,
      latestPing: { at: latest.at, speedKmph: latest.speed },
      pingsInHaltWindow: pingsInHaltWindow.map((p) => ({ at: p.at, speedKmph: p.speed })),
      ewayValidTill: t.ewayValidTill,
      thresholds,
    });

    return {
      vehicleNo: t.vehicleNo,
      tripCode: t.tripCode,
      vendorName: t.vendorName,
      lane: t.lane ?? '',
      // Best-effort: no route/distance is stored anywhere in the schema
      // to compute true GPS progress, so this is elapsed-time-against-
      // expected-transit-duration, not distance-along-route. Replace
      // once a route distance or milestone-timestamp column exists.
      progressPct: estimateProgressPct(t.tripCreatedAt, t.transitDaysRequired, now),
      speedKmph: latest.speed ?? 0,
      fuelPct: latest.fuel ?? 0,
      lastPingAt: latest.at,
      lat: latest.lat === null ? 0 : Number(latest.lat),
      lng: latest.lng === null ? 0 : Number(latest.lng),
      ewayValidTill: t.ewayValidTill,
      alerts,
    };
  }
}

function estimateProgressPct(tripCreatedAt: string, transitDaysRequired: number | null, now: number): number {
  if (!transitDaysRequired || transitDaysRequired <= 0) return 0;
  const elapsedMs = now - Date.parse(tripCreatedAt);
  const expectedMs = transitDaysRequired * 86_400_000;
  return Math.max(0, Math.min(100, Math.round((elapsedMs / expectedMs) * 100)));
}
