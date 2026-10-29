import { NextRequest, NextResponse } from 'next/server';
import { positionsOf } from '@/lib/server/gps';
import { integrationOn } from '@/lib/server/integrations';
import { peopleStoreConfigured } from '@/lib/server/people-store';
import { signedInPerson } from '@/lib/server/admin-session';

export const dynamic = 'force-dynamic';

const MAX_TRUCKS = 50;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * GET /api/telematics/positions?vehicles=MH12QR8841,MH04TT2019 — the latest
 * GPS position of each truck asked for. Anyone signed in to the console; a
 * truck that has not reported is simply absent.
 */
export async function GET(request: NextRequest) {
  if (!(await signedInPerson(request))) {
    return json({ error: 'Sign in to see where the trucks are.' }, 401);
  }
  if (!peopleStoreConfigured() || !(await integrationOn('gps'))) return json({ positions: {} });
  const vehicles = (request.nextUrl.searchParams.get('vehicles') ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, MAX_TRUCKS);
  try {
    return json({ positions: await positionsOf(vehicles) });
  } catch (e) {
    console.error('[gps] positions failed:', (e as Error).message);
    return json({ error: 'The positions could not be read just now.' }, 502);
  }
}
