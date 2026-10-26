import { NextRequest, NextResponse } from 'next/server';
import { SHOWN, nearest } from '@/lib/server/fuel';
import { integrationOn } from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';
// Long enough to go down the list of sources below when the first ones are busy.
export const maxDuration = 30;

/**
 * GET /api/fuel?lat=&lng= — the fuel stations nearest a point, nearest first.
 *
 * The stations come from OpenStreetMap's data. It is asked for from here rather
 * than from the browser because the services that serve it turn away requests
 * that look like a script dressed as a browser, and answer ones that say
 * plainly who they are — which a browser cannot do, as it may not set its own
 * User-Agent.
 *
 * Looked for within 30 km first and, where that finds nothing, within 80 km.
 * The distance is straight-line. Only a latitude and a longitude are taken, so
 * this cannot be used to ask those services for anything else.
 */

export async function GET(request: NextRequest) {
  const lat = Number(request.nextUrl.searchParams.get('lat'));
  const lng = Number(request.nextUrl.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: 'Give a latitude and a longitude.' }, { status: 400 });
  }
  if (!(await integrationOn('fuel'))) {
    return NextResponse.json({ error: 'Nearest fuel is switched off on the Integrations screen.' }, { status: 403 });
  }
  try {
    const stations = await nearest(lat, lng);
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
