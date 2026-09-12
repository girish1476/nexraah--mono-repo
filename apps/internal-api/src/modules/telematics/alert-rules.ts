import { AlertKind } from './telematics.constants';

/**
 * The `BR-19` alert rules, as one pure function — no DB, no clock (`now` is
 * a parameter). Kept separate from `TelematicsService` so it's directly
 * testable without a database, and reusable from both the ping-ingest path
 * and (once one exists) a periodic re-evaluation job — part 11 §2 calls for
 * both ("derived on ingest and again every 15 minutes").
 */

export interface PingSample {
  at: string; // ISO 8601
  speedKmph: number | null;
}

export interface TelematicsThresholds {
  overspeedKmph: number;
  haltMinutes: number;
  darkVehicleIntervalMinutes: number;
  ewayWarningWindowHours: number;
}

export interface AlertRuleInput {
  now: number; // Date.now()-shaped epoch ms
  latestPing: PingSample | undefined;
  /**
   * Pings for the LONG_HALT check, any order. Deliberately covers MORE than
   * `now - haltMinutes` — the caller (`telematics.service.ts`'s
   * `haltQuerySinceIso`) fetches further back on purpose, so that
   * `windowFullyCovered` below can find a ping older than the raw
   * `haltMinutes` boundary and prove the vehicle was covered by pings for the
   * whole window, rather than being structurally unable to ever satisfy that
   * comparison.
   */
  pingsInHaltWindow: PingSample[];
  ewayValidTill: string | null;
  thresholds: TelematicsThresholds;
}

/** Below this, a truck is treated as stationary rather than "moving slowly". */
const STATIONARY_SPEED_KMPH = 2;

export function deriveAlerts(input: AlertRuleInput): AlertKind[] {
  const { now, latestPing, pingsInHaltWindow, ewayValidTill, thresholds } = input;
  const alerts: AlertKind[] = [];

  const latestAgeMs = latestPing ? now - Date.parse(latestPing.at) : Infinity;
  const isDark = latestAgeMs > thresholds.darkVehicleIntervalMinutes * 60_000;

  if (isDark) {
    alerts.push('DARK_VEHICLE');
  } else {
    if (latestPing?.speedKmph != null && latestPing.speedKmph > thresholds.overspeedKmph) {
      alerts.push('OVERSPEED');
    }

    // LONG_HALT needs the halt window fully covered by stationary pings, not
    // just a couple of recent slow ones — otherwise a truck stuck at a
    // signal for two minutes reads the same as one parked for two hours.
    const haltWindowMs = thresholds.haltMinutes * 60_000;
    const oldestInWindow = pingsInHaltWindow.reduce<number | null>((oldest, p) => {
      const t = Date.parse(p.at);
      return oldest === null || t < oldest ? t : oldest;
    }, null);
    const windowFullyCovered = oldestInWindow !== null && now - oldestInWindow >= haltWindowMs;
    const allStationary = pingsInHaltWindow.every((p) => (p.speedKmph ?? 0) <= STATIONARY_SPEED_KMPH);
    if (windowFullyCovered && allStationary) {
      alerts.push('LONG_HALT');
    }
  }

  if (ewayValidTill) {
    const validTillMs = Date.parse(ewayValidTill);
    const msRemaining = validTillMs - now;
    if (msRemaining <= 0) {
      alerts.push('EWAY_EXPIRED');
    } else if (msRemaining <= thresholds.ewayWarningWindowHours * 3_600_000) {
      alerts.push('EWAY_EXPIRING');
    }
  }

  return alerts;
}
