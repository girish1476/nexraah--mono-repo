import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, checkCode, findPerson, openChallenge, realEmailConfigured, seal } from '@/lib/server/sign-in-code';

export const dynamic = 'force-dynamic';

const MESSAGES = {
  NO_CODE: 'Send a code first.',
  WRONG_EMAIL: 'Send a code to this email first.',
  EXPIRED: 'That code has expired. Send a new code.',
  TOO_MANY: 'Too many wrong codes. Send a new code.',
  WRONG_CODE: 'That code is wrong. Check the latest email and try again.',
} as const;

/**
 * POST /api/sign-in/verify { email, code } — checks the emailed code. On
 * success it answers with who signed in (email, role, name from SIGNIN_PEOPLE)
 * and the challenge cookie is cleared, so a code works once.
 */
export async function POST(request: NextRequest) {
  if (!realEmailConfigured()) {
    return NextResponse.json({ error: 'Email sign-in is not configured on this deployment.' }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { email?: string; code?: string };
  const email = String(body.email ?? '').trim().toLowerCase();
  const code = String(body.code ?? '');
  const secret = process.env.SIGNIN_SECRET as string;
  const challenge = openChallenge(secret, request.cookies.get(COOKIE_NAME)?.value);
  const result = checkCode(secret, challenge, email, code);
  const cookieOptions = { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict' as const, path: '/api/sign-in' };

  if (!result.ok) {
    const response = NextResponse.json({ error: MESSAGES[result.reason] }, { status: 400 });
    if (result.next && challenge) {
      // One more wrong try counted; the cookie still ends when the code does.
      response.cookies.set(COOKIE_NAME, seal(secret, result.next), {
        ...cookieOptions,
        maxAge: Math.max(1, challenge.x - Math.floor(Date.now() / 1000)),
      });
    }
    return response;
  }

  const person = findPerson(email);
  if (!person) return NextResponse.json({ error: 'This email is no longer allowed to sign in.' }, { status: 403 });
  const response = NextResponse.json({ ok: true, person }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(COOKIE_NAME, '', { ...cookieOptions, maxAge: 0 });
  return response;
}
