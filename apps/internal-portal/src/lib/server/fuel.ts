/**
 * The fuel stations nearest a point, from OpenStreetMap's data — asked of the
 * sources below in turn. Used by app/api/fuel and by the Integrations screen's
 * connection check.
 */

export const AGENT = 'nexraah-console/1.0 (nearest fuel lookup for the truck map)';
/** How many stations are given back. */
export const SHOWN = 8;
/** How long one source is given before the next is tried. */
const PER_SOURCE_MS = 7_000;
/** After this long no further source is started; what has failed is reported. */
const GIVE_UP_MS = 24_000;

export interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  km: number;
}

type Source = { name: string; within: (km: number, lat: number, lng: number) => Promise<Station[]> };

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

const nearestFirst = (stations: Station[]) => stations.sort((a, b) => a.km - b.km);

/** Photon — a search service over the same data. Quick, and seldom busy, so it is asked first. */
const photon: Source = {
  name: 'photon.komoot.io',
  async within(km, lat, lng) {
    const response = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&osm_tag=amenity:fuel&radius=${km}&limit=40`, {
      headers: { 'User-Agent': AGENT, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(PER_SOURCE_MS),
    });
    if (!response.ok) throw new Error(`answered ${response.status}`);
    const body = (await response.json()) as {
      features?: {
        properties?: { osm_type?: string; osm_id?: number; osm_value?: string; name?: string };
        geometry?: { coordinates?: [number, number] };
      }[];
    };
    if (!Array.isArray(body.features)) throw new Error('gave no list');
    const kind: Record<string, string> = { N: 'node', W: 'way', R: 'relation' };
    const stations: Station[] = [];
    for (const f of body.features) {
      const [sLng, sLat] = f.geometry?.coordinates ?? [];
      const p = f.properties ?? {};
      if (typeof sLat !== 'number' || typeof sLng !== 'number' || p.osm_value !== 'fuel') continue;
      stations.push({
        id: `${kind[p.osm_type ?? ''] ?? 'node'}/${p.osm_id}`,
        name: p.name || 'Fuel station',
        lat: sLat,
        lng: sLng,
        km: kmBetween(lat, lng, sLat, sLng),
      });
    }
    return nearestFirst(stations);
  },
};

/**
 * Overpass — the data's own query service, kept as the fallback. Its free
 * public servers are often busy for minutes at a time, so more than one is
 * listed and they are tried in turn.
 */
const overpass = (server: string): Source => ({
  name: new URL(server).host,
  async within(km, lat, lng) {
    const query = `[out:json][timeout:20];nwr["amenity"="fuel"](around:${km * 1000},${lat},${lng});out center 80;`;
    const response = await fetch(server, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': AGENT, Accept: 'application/json' },
      body: `data=${encodeURIComponent(query)}`,
      cache: 'no-store',
      signal: AbortSignal.timeout(PER_SOURCE_MS),
    });
    if (!response.ok) throw new Error(`answered ${response.status}`);
    const body = (await response.json()) as {
      elements?: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[];
    };
    // A busy server can answer 200 with a note that it ran out of time, and no list.
    if (!Array.isArray(body.elements)) throw new Error('gave no list');
    const stations: Station[] = [];
    for (const e of body.elements) {
      const sLat = e.lat ?? e.center?.lat;
      const sLng = e.lon ?? e.center?.lon;
      if (typeof sLat !== 'number' || typeof sLng !== 'number') continue;
      const tags = e.tags ?? {};
      stations.push({
        id: `${e.type}/${e.id}`,
        name: tags.name || tags.brand || tags.operator || 'Fuel station',
        lat: sLat,
        lng: sLng,
        km: kmBetween(lat, lng, sLat, sLng),
      });
    }
    return nearestFirst(stations);
  },
});

const SOURCES: Source[] = [
  photon,
  overpass('https://overpass-api.de/api/interpreter'),
  overpass('https://overpass.kumi.systems/api/interpreter'),
  overpass('https://maps.mail.ru/osm/tools/overpass/api/interpreter'),
];

/** The first source to answer is used; fails only when none of them did. */
export async function nearest(lat: number, lng: number): Promise<Station[]> {
  const started = Date.now();
  const failures: string[] = [];
  for (const source of SOURCES) {
    if (Date.now() - started > GIVE_UP_MS) break;
    try {
      const close = await source.within(30, lat, lng);
      return close.length > 0 ? close : await source.within(80, lat, lng);
    } catch (e) {
      failures.push(`${source.name} ${(e as Error).message}`);
    }
  }
  throw new Error(failures.join('; '));
}

