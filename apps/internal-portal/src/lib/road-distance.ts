import { useEffect, useState } from 'react';
import { integrationSwitches } from './integration-switches';
import { searchPlaces } from './place-search';

/**
 * How far a load goes by road, pick-up city to delivery city: the two ends are
 * found by the Place finder, the road by OSRM's public router (free, no key,
 * CORS-open). Control → Integrations → Road distance switches it.
 *
 * Each lane is asked once and remembered in this browser — the public router
 * is for light use, and a lane's length does not change.
 */

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const KEY = 'nexraah.road-km.v1';

/** OSRM's answer → whole kilometres, or null when it found no road. */
export function parseOsrmKm(body: unknown): number | null {
  const b = body as { code?: string; routes?: { distance?: number }[] };
  const metres = b?.code === 'Ok' ? b.routes?.[0]?.distance : undefined;
  return typeof metres === 'number' && metres > 0 ? Math.round(metres / 1000) : null;
}

/** "Bengaluru → Chennai" (or "Bengaluru - Chennai") → its two ends. */
export function laneEnds(lane: string): [string, string] {
  const [from = '', to = ''] = lane.split(/\s*(?:→|->|–|—|\s-\s)\s*/).map((x) => x.trim());
  return [from, to];
}

const laneKey = (from: string, to: string) => `${from.trim().toLowerCase()}|${to.trim().toLowerCase()}`;

function remembered(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

export async function roadDistanceKm(from: string, to: string, signal?: AbortSignal): Promise<number | null> {
  if (!from.trim() || !to.trim() || !(await integrationSwitches()).distance) return null;
  const key = laneKey(from, to);
  const known = remembered()[key];
  if (known) return known;
  const [a, b] = await Promise.all([searchPlaces(from, signal), searchPlaces(to, signal)]);
  if (!a[0] || !b[0]) return null;
  try {
    const res = await fetch(`${OSRM}/${a[0].lng},${a[0].lat};${b[0].lng},${b[0].lat}?overview=false`, { signal });
    const km = res.ok ? parseOsrmKm(await res.json()) : null;
    if (km) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...remembered(), [key]: km }));
      } catch {
        // Not remembered; asked again next time.
      }
    }
    return km;
  } catch {
    return null;
  }
}

/**
 * The distance to show for a lane: the one typed on the record when there is
 * one, else the road distance once worked out. Undefined while unknown.
 */
export function useRoadDistance(from: string | undefined, to: string | undefined, typed?: number | null): number | undefined {
  const [km, setKm] = useState<number | undefined>(typed ?? undefined);
  useEffect(() => {
    if (typed != null) return setKm(typed);
    if (!from || !to) return;
    const controller = new AbortController();
    roadDistanceKm(from, to, controller.signal).then((d) => !controller.signal.aborted && d && setKm(d));
    return () => controller.abort();
  }, [from, to, typed]);
  return km;
}
