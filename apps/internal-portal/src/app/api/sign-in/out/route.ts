import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/server/sign-in-code';

export const dynamic = 'force-dynamic';

/** POST /api/sign-in/out — ends the server's session, so the next person on this browser starts with none. */
export function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'strict',
    path: '/api',
    maxAge: 0,
  });
  return response;
}
