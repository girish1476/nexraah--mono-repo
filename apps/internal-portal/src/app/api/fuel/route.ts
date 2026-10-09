import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/fuel?lat=&lng= — the fuel stations nearest a point, nearest first.
 *
 * The stations come from OpenStreetMap's data, asked through its Overpass
 * service. The console asks from here rather than from the browser because
 * that service turns away requests that look like a script dressed as a
 * browser, and answers ones that say plainly who they are — which a browser
 * cannot do, as it may not set its own User-Agent.
 *
 * Looked for within 30 km first and, where that finds nothing, within 80 km.
 * The distance is straight-line. Only a latitude and a longitude are taken, so
 * this cannot be used to ask Overpass for anything else.
 */

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const AGENT = 'nexraah-console/1.0 (nearest fuel lookup for the truck map)';
const SHOWN = 8;

interface Station {
  id: string;
  name: string;
  lat: number;
  lng: number;
  km: number;
}

function kmBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

async function within(metres: number, lat: number, lng: number): Promise<Station[]> {
  const query = `[out:json][timeout:20];nwr["amenity"="fuel"](around:${metres},${lat},${lng});out center 80;`;
  const response = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': AGENT, Accept: 'application/json' },
    body: `data=${encodeURIComponent(query)}`,
    cache: 'no-store',
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
  const body = (await response.json()) as {
    elements?: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[];
  };
  const stations: Station[] = [];
  for (const e of body.elements ?? []) {
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
  return stations.sort((a, b) => a.km - b.km);
}

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get('lat'));
  const lng = Number(request.nextUrl.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'Give a latitude and a longitude.' }, { status: 400 });
  }
  try {
    let stations = await within(30_000, lat, lng);
    if (stations.length === 0) stations = await within(80_000, lat, lng);
    return NextResponse.json(
      { stations: stations.slice(0, SHOWN) },
      // Fuel stations do not move: the same place may be answered from memory for a while.
      { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=1800' } },
    );
  } catch (e) {
    console.error('[fuel] lookup failed:', (e as Error).message);
    return NextResponse.json({ error: 'The fuel search could not be made just now.' }, { status: 502 });
  }
}
