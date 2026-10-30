/**
 * Live truck positions reported by GPS units and tracking apps (Control →
 * Integrations → GPS tracking), as the console's server keeps them
 * (app/api/telematics/positions).
 *
 * Asked for by the fleet board and the Tracking tab. Whatever goes wrong —
 * not signed in by email, GPS switched off, offline — the answer is "no live
 * positions", and those screens show what Ops typed in, as before.
 */

import { integrationSwitches } from './integration-switches';

export interface LivePosition {
  vehicleNo: string;
  lat: number;
  lng: number;
  at: string;
  speedKmph: number | null;
  fuelPct: number | null;
}

/** The fleet board polls every 30 seconds; a few seconds' memory keeps several viewers' panels to one request. */
const MEMO_MS = 15_000;
let memo: { key: string; at: number; value: Record<string, LivePosition> } | null = null;

export async function livePositions(vehicleNos: (string | null | undefined)[]): Promise<Record<string, LivePosition>> {
  const list = [...new Set(vehicleNos.filter((v): v is string => !!v && !!v.trim()))].slice(0, 50);
  // No server to ask during unit tests (VITEST is never set in a browser build).
  if (!list.length || typeof window === 'undefined' || typeof fetch === 'undefined' || process.env.VITEST) return {};
  // No GPS device key set up (Control → Integrations): no position can exist, so no round trip —
  // it held up the fleet board and the Tracking tab by a server call each time.
  if (!(await integrationSwitches()).gps) return {};
  const key = list.join('|');
  if (memo && memo.key === key && Date.now() - memo.at < MEMO_MS) return memo.value;
  try {
    // The sign-in token, for a deployment on the real API (lib/server/admin-session.ts); the
    // browser-only one signs in with a cookie and ignores it. Read here rather than through
    // lib/auth, which imports the fixture adapter that imports this file.
    const token = window.localStorage.getItem('token');
    const response = await fetch(`/api/telematics/positions?vehicles=${encodeURIComponent(list.join(','))}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    });
    if (!response.ok) return {};
    const body = (await response.json()) as { positions?: Record<string, LivePosition> };
    const value = body.positions ?? {};
    memo = { key, at: Date.now(), value };
    return value;
  } catch {
    return {};
  }
}

/* ---- laying a live position over a record ---------------------------------------
   Used by the browser-only adapter (src/mocks) and, on the real API, by the
   fleet board's and the tracking sheet's own calls (app/telematics/apis.ts,
   app/trips/apis.ts). Never saved: the next report replaces it. */

const later = (than: string | null | undefined, at: string) => !than || Date.parse(at) > Date.parse(than);

interface BoardRow {
  lastPingAt?: string | null;
  speedKmph?: number | null;
  fuelPct?: number | null;
  alerts?: string[];
}

/**
 * A fleet-board row with the truck's live GPS position over it, when one has
 * come in since the row last changed. A fresh report means the truck is not
 * dark; with the board's limit given, its speed is checked against it again.
 */
export function withLiveGps<T extends BoardRow>(row: T, live: LivePosition | undefined, overspeedKmph?: number | null): T {
  if (!row || !live || !later(row.lastPingAt, live.at)) return row;
  const speed = live.speedKmph ?? row.speedKmph ?? 0;
  const alerts = (row.alerts ?? []).filter((a) => a !== 'DARK_VEHICLE' && (overspeedKmph == null || a !== 'OVERSPEED'));
  if (overspeedKmph != null && speed > overspeedKmph) alerts.push('OVERSPEED');
  return { ...row, lat: live.lat, lng: live.lng, speedKmph: speed, fuelPct: live.fuelPct ?? row.fuelPct, lastPingAt: live.at, lastUpdatedBy: 'GPS', alerts };
}

interface SheetLike {
  vehicleNo: string | null;
  departedAt: string | null;
  deliveredAt: string | null;
  updates: { recordedAt: string }[];
}

/** A tracking sheet with the truck's live GPS position as its newest update, while the truck is on the road. */
export function withLiveUpdate<T extends SheetLike>(sheet: T, live: LivePosition | undefined): T {
  if (!sheet.vehicleNo || !sheet.departedAt || sheet.deliveredAt || !live) return sheet;
  const last = sheet.updates[sheet.updates.length - 1];
  if (last && !later(last.recordedAt, live.at)) return sheet;
  const speed = live.speedKmph;
  const update = {
    id: 'gps-live',
    kind: 'UPDATE',
    location: 'Live GPS position',
    lat: live.lat,
    lng: live.lng,
    note: speed === null ? null : `${speed} km/h`,
    status: speed === null ? null : speed >= 5 ? 'MOVING' : 'HALTED',
    recordedAt: live.at,
    recordedByName: 'GPS',
    recordedByPhone: null,
  };
  return { ...sheet, updates: [...sheet.updates, update] };
}
