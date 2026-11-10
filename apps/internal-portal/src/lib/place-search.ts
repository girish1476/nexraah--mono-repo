import { integrationSwitches } from './integration-switches';

/**
 * Turning a place name into a point, and a point back into a name, for
 * screens where Ops keys in where a truck is.
 *
 * Nobody on a phone call with a driver is told "19.997454, 73.789803" — they
 * are told "just past the Nagpur bypass". Photon (a free search over
 * OpenStreetMap's data, no key, answers a browser directly) is made for
 * search-as-you-type; Nominatim, which the truck map uses for single lookups,
 * asks that it not be used that way. Both sit under the same "Place finder"
 * switch in Control → Integrations.
 */

export interface PlaceHit {
  /** What a person reads: "Kurnool, Andhra Pradesh". */
  label: string;
  lat: number;
  lng: number;
}

const PHOTON = 'https://photon.komoot.io';
/** India, west-south-east-north — results outside it are of no use to this business. */
const INDIA_BBOX = '68.0,6.5,97.5,35.7';

interface PhotonFeature {
  properties?: {
    name?: string;
    street?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    countrycode?: string;
  };
  geometry?: { coordinates?: [number, number] };
}

/** "Name, town, state" from one Photon answer — each part once, empty parts dropped. */
export function photonLabel(p: NonNullable<PhotonFeature['properties']>): string {
  const parts: string[] = [];
  for (const part of [p.name ?? p.street, p.city ?? p.district, p.county, p.state]) {
    const s = part?.trim();
    if (s && !parts.some((x) => x.toLowerCase() === s.toLowerCase())) parts.push(s);
  }
  return parts.join(', ');
}

/** Photon's answer as places, in India only, one row per distinct label. */
export function parsePhoton(body: unknown): PlaceHit[] {
  const features = (body as { features?: PhotonFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const hits: PlaceHit[] = [];
  for (const f of features) {
    const c = f.geometry?.coordinates;
    if (!f.properties || !Array.isArray(c) || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    if (f.properties.countrycode && f.properties.countrycode.toUpperCase() !== 'IN') continue;
    const label = photonLabel(f.properties);
    if (!label || hits.some((h) => h.label === label)) continue;
    hits.push({ label, lat: round6(c[1]), lng: round6(c[0]) });
  }
  return hits;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Whether an administrator has left place lookups on. */
export async function placeFinderOn(): Promise<boolean> {
  return (await integrationSwitches()).geocode;
}

/** Places matching what was typed, best first. Empty when nothing matched, the finder is off, or offline. */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const q = query.trim();
  if (q.length < 2 || !(await placeFinderOn())) return [];
  try {
    const res = await fetch(`${PHOTON}/api/?q=${encodeURIComponent(q)}&limit=6&lang=en&bbox=${INDIA_BBOX}`, { signal });
    return res.ok ? parsePhoton(await res.json()) : [];
  } catch {
    return [];
  }
}

const NAMES_KEY = 'nexraah.place-names.v1';

/** The name of the place nearest a point — "near Wadgaon, Maharashtra" on the update form. Null when unknown. */
export async function nameOfPoint(lat: number, lng: number): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  let known: Record<string, string> = {};
  try {
    known = JSON.parse(window.localStorage.getItem(NAMES_KEY) ?? '{}');
  } catch {
    // Blocked storage: asked every time instead.
  }
  if (known[key]) return known[key];
  if (!(await placeFinderOn())) return null;
  try {
    const res = await fetch(`${PHOTON}/reverse?lat=${lat}&lon=${lng}&lang=en&limit=1`);
    if (!res.ok) return null;
    const name = parsePhoton(await res.json())[0]?.label ?? null;
    if (name) {
      try {
        window.localStorage.setItem(NAMES_KEY, JSON.stringify({ ...known, [key]: name }));
      } catch {
        // Storage full or blocked: asked again next time.
      }
    }
    return name;
  } catch {
    return null;
  }
}
