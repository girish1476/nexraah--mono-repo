import { NextRequest, NextResponse } from 'next/server';
import { PingRefused, keepPosition, readPing } from '@/lib/server/gps';
import { gpsDeviceKey } from '@/lib/server/integrations';
import { peopleStoreConfigured } from '@/lib/server/people-store';

export const dynamic = 'force-dynamic';

/** A report is a few numbers; anything much larger is not one. */
const MAX_BODY = 4_096;

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST (or GET) /api/telematics/ping — a GPS unit or tracking app reporting
 * where a truck is. Set up under Control → Integrations → GPS tracking; the
 * formats it takes are in lib/server/gps.ts. Not called by the console itself.
 */
async function ping(request: NextRequest) {
  if (!peopleStoreConfigured()) return json({ error: 'GPS tracking is not set up on this deployment.' }, 503);
  const deviceKey = await gpsDeviceKey();
  if (!deviceKey) return json({ error: 'GPS tracking is switched off, or has no device key yet.' }, 503);

  const raw = request.method === 'POST' ? await request.text() : '';
  if (raw.length > MAX_BODY) return json({ error: 'The report is too large.' }, 413);
  const auth = request.headers.get('authorization') ?? '';
  try {
    const position = readPing(
      {
        raw,
        contentType: request.headers.get('content-type') ?? '',
        query: Object.fromEntries(request.nextUrl.searchParams),
        signature: request.headers.get('x-telematics-signature'),
        bearer: /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '').trim() : null,
      },
      deviceKey,
    );
    const outcome = await keepPosition(position);
    return json({ ok: true, vehicleNo: position.vehicleNo, at: position.at, kept: outcome === 'kept' });
  } catch (e) {
    if (e instanceof PingRefused) return json({ error: e.message }, e.status);
    console.error('[gps] report failed:', (e as Error).message);
    return json({ error: 'The report could not be kept. It can be sent again.' }, 502);
  }
}

export const POST = ping;
export const GET = ping;
