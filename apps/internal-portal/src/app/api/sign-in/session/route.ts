import { NextRequest, NextResponse } from 'next/server';
import { allowedPerson } from '@/lib/server/people-store';
import { SESSION_COOKIE, SESSION_TTL_S, issueSession, openSession, realEmailConfigured } from '@/lib/server/sign-in-code';

export const dynamic = 'force-dynamic';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST /api/sign-in/session — whether the server's own session is still good,
 * and another week of it if so. The console asks as it opens: the token the page
 * keeps renews itself for as long as the console is used, so a session cookie
 * that only ever ran from the sign-in ended a week later with the page still
 * looking signed in and every administrator's screen refused.
 *
 * 401 means the session is over: the cookie is missing, expired or signed with
 * an old secret, or this person is no longer allowed in. Anything else says
 * nothing about the session, and the console carries on.
 */
export async function POST(request: NextRequest) {
  if (!realEmailConfigured()) return json({ error: 'Email sign-in is not configured on this deployment.' }, 503);
  const secret = process.env.SIGNIN_SECRET as string;
  const email = openSession(secret, request.cookies.get(SESSION_COOKIE)?.value);
  if (!email) return json({ error: 'The session has ended.' }, 401);
  let person;
  try {
    person = await allowedPerson(email);
  } catch (e) {
    console.error('[sign-in] people list failed:', (e as Error).message);
    return json({ error: 'The session could not be checked just now.' }, 502);
  }
  if (!person) return json({ error: 'This email is no longer allowed to sign in.' }, 401);
  const response = json({ ok: true });
  response.cookies.set(SESSION_COOKIE, issueSession(secret, email), {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'strict',
    path: '/api',
    maxAge: SESSION_TTL_S,
  });
  return response;
}
