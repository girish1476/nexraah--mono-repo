import { NextResponse } from 'next/server';
import { realEmailConfigured } from '@/lib/server/sign-in-code';
import { peopleStoreConfigured } from '@/lib/server/people-store';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sign-in/status — whether sign-in codes go out by real email on this
 * deployment, and whether the Users screen's list is kept on the server (so a
 * person added there can sign in from any device).
 */
export function GET() {
  const realEmail = realEmailConfigured();
  return NextResponse.json(
    { realEmail, peopleStore: realEmail && peopleStoreConfigured() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
