import { NextResponse } from 'next/server';
import { realEmailConfigured } from '@/lib/server/sign-in-code';

export const dynamic = 'force-dynamic';

/** GET /api/sign-in/status — whether sign-in codes go out by real email on this deployment. */
export function GET() {
  return NextResponse.json({ realEmail: realEmailConfigured() }, { headers: { 'Cache-Control': 'no-store' } });
}
