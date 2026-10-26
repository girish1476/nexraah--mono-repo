/**
 * Live truck positions reported by GPS units and tracking apps (Control →
 * Integrations → GPS tracking), as the console's server keeps them
 * (app/api/telematics/positions).
 *
 * Asked for by the fleet board and the Tracking tab. Whatever goes wrong —
 * not signed in by email, GPS switched off, offline — the answer is "no live
 * positions", and those screens show what Ops typed in, as before.
 */

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
  const key = list.join('|');
  if (memo && memo.key === key && Date.now() - memo.at < MEMO_MS) return memo.value;
  try {
    const response = await fetch(`/api/telematics/positions?vehicles=${encodeURIComponent(list.join(','))}`, {
      cache: 'no-store',
      credentials: 'same-origin',
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
