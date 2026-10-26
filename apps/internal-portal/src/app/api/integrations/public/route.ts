import { NextResponse } from 'next/server';
import { publicSwitches } from '@/lib/server/integrations';

export const dynamic = 'force-dynamic';

/**
 * GET /api/integrations/public — which outside services are switched on, for
 * every browser. Holds no secret: the one key in it (Google Maps) is one a
 * browser has to use itself.
 */
export async function GET() {
  return NextResponse.json(await publicSwitches(), {
    headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30' },
  });
}
