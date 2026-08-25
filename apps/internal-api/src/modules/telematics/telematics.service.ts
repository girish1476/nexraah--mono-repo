import { Injectable } from '@nestjs/common';
import { ConfigRepository } from '../config/config.repository';
import { DomainException } from '../../common/domain-exception';
import { TelematicsRepository } from './telematics.repository';
import { deriveAlerts, TelematicsThresholds } from './alert-rules';
import { ALERT_KINDS, AlertKind } from './telematics.constants';
import type { PingDto } from './dto/ping.dto';
import type { ManualUpdateDto } from './dto/manual-update.dto';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

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

  /**
   * Re-derives alerts for every vehicle currently on an open trip and
   * reconciles them — the periodic counterpart to `ingestPing`'s per-vehicle
   * call, for the two background jobs that don't wait on a ping to notice a
   * change (a vehicle that's gone dark generates no ping to react to; an
   * e-way bill expires on a clock, not an event). `telematics-alerts` (every
   * 15 min) and `eway-expiry` (hourly) both call this — the e-way branch of
   * `deriveAlerts` depends only on `now`/`ewayValidTill`/the configured
   * warning window, so there is nothing eway-specific to run separately.
   */
  async reconcileAllOpenTrips(): Promise<void> {
    const trips = await this.repository.openTripsWithVehicle();
    await Promise.all(
      trips
        .filter((t): t is typeof t & { vehicleNo: string } => !!t.vehicleNo)
        .map((t) => this.reconcileAlerts(t.vehicleNo, t.tripId, t.ewayValidTill)),
    );
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

    const wanted = new Set([
      ...deriveAlerts({
        now,
        latestPing: latest ? { at: latest.at, speedKmph: latest.speed } : undefined,
        pingsInHaltWindow: pingsInHaltWindow.map((p) => ({ at: p.at, speedKmph: p.speed })),
        ewayValidTill,
        thresholds,
      }),
      ...manualAlerts(latest?.raw),
    ]);

    const activeKinds = new Set(active.map((a) => a.kind));

    await Promise.all([
      ...active.filter((a) => !wanted.has(a.kind as AlertKind)).map((a) => this.repository.clearAlert(a.id)),
      ...[...wanted].filter((kind) => !activeKinds.has(kind)).map((kind) => this.repository.raiseAlert(vehicleNo, tripId, kind)),
    ]);
  }

  /**
   * `PATCH /telematics/vehicles/:vehicleNo` — the manual update behind the
   * board's "Update" action. There is no GPS provider, so what Ops was told
   * on the phone is recorded as a ping with `raw.source = 'MANUAL'` and runs
   * through the same alert derivation as a provider ping; anything omitted
   * carries the last known value forward. The e-way validity is written to
   * the open trip, which is where the board reads it from. Alerts Ops ticks
   * by hand ride on the ping's `raw` and stay on the board for as long as
   * that manual update is the latest word on the vehicle (`manualAlerts`).
   */
  async manualUpdate(vehicleNo: string, dto: ManualUpdateDto, actor: AuthenticatedUser) {
    const trip = await this.repository.findOpenTripByVehicleNo(vehicleNo);
    if (!trip) {
      throw new DomainException(404, 'NOT_FOUND', `${vehicleNo} is not on any open trip.`);
    }

    const previous = await this.repository.latestPing(vehicleNo);
    const carry = (next: number | undefined, prior: string | number | null | undefined) =>
      next ?? (prior === null || prior === undefined ? null : Number(prior));

    await this.repository.insertPing({
      vehicleNo,
      at: new Date().toISOString(),
      lat: carry(dto.lat, previous?.lat),
      lng: carry(dto.lng, previous?.lng),
      speedKmph: carry(dto.speedKmph, previous?.speed),
      fuelPct: carry(dto.fuelPct, previous?.fuel),
      raw: { source: 'MANUAL', by: actor.userId, name: actor.name, alerts: dto.alerts ?? [] },
    });

    let ewayValidTill = trip.ewayValidTill;
    if (dto.ewayValidTill !== undefined && dto.ewayValidTill !== trip.ewayValidTill) {
      await this.repository.updateTripEwayValidTill(trip.id, dto.ewayValidTill);
      ewayValidTill = dto.ewayValidTill;
    }

    await this.reconcileAlerts(vehicleNo, trip.id, ewayValidTill);

    const snapshot = await this.forVehicle(vehicleNo);
    if (!snapshot) {
      // We just inserted a ping on an open trip, so this cannot happen short of a concurrent trip close.
      throw new DomainException(409, 'TRIP_NOT_OPEN', `${vehicleNo} is no longer on an open trip.`);
    }
    return snapshot;
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

    const alerts = [
      ...new Set([
        ...deriveAlerts({
          now,
          latestPing: { at: latest.at, speedKmph: latest.speed },
          pingsInHaltWindow: pingsInHaltWindow.map((p) => ({ at: p.at, speedKmph: p.speed })),
          ewayValidTill: t.ewayValidTill,
          thresholds,
        }),
        ...manualAlerts(latest.raw),
      ]),
    ];

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

/**
 * Alerts Ops asserted by hand on a manual update (`manualUpdate`), read back
 * off the ping's `raw`. Only honoured while that ping is the latest one —
 * a newer ping (manual or provider) supersedes it, which is exactly when the
 * hand-keyed picture stops being the freshest information.
 */
function manualAlerts(raw: unknown): AlertKind[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as { source?: unknown; alerts?: unknown };
  if (r.source !== 'MANUAL' || !Array.isArray(r.alerts)) return [];
  return r.alerts.filter((a): a is AlertKind => (ALERT_KINDS as string[]).includes(String(a)));
}

function estimateProgressPct(tripCreatedAt: string, transitDaysRequired: number | null, now: number): number {
  if (!transitDaysRequired || transitDaysRequired <= 0) return 0;
  const elapsedMs = now - Date.parse(tripCreatedAt);
  const expectedMs = transitDaysRequired * 86_400_000;
  return Math.max(0, Math.min(100, Math.round((elapsedMs / expectedMs) * 100)));
}
