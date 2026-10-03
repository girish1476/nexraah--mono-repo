import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  CODE_TTL_S,
  COOKIE_NAME,
  RESEND_AFTER_S,
  findPerson,
  issueChallenge,
  newCode,
  openChallenge,
  realEmailConfigured,
} from '@/lib/server/sign-in-code';
import { renderSignInEmail } from '@/lib/server/sign-in-email';
import { sendEmail } from '@/lib/server/mailer';

export const dynamic = 'force-dynamic';

const NOT_ALLOWED = 'This email is not allowed to sign in. Ask an administrator to add it.';

/**
 * POST /api/sign-in/send { email } — emails a fresh 4-minute code to someone
 * on the server's list (SIGNIN_PEOPLE). Anyone else gets the same refusal,
 * and no email goes out: this is not an open mailer.
 */
export async function POST(request: NextRequest) {
  if (!realEmailConfigured()) {
    return NextResponse.json({ error: 'Email sign-in is not configured on this deployment.' }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? '').trim().toLowerCase();
  const person = email ? findPerson(email) : undefined;
  if (!person) return NextResponse.json({ error: NOT_ALLOWED }, { status: 403 });

  const secret = process.env.SIGNIN_SECRET as string;
  const now = Math.floor(Date.now() / 1000);
  const previous = openChallenge(secret, request.cookies.get(COOKIE_NAME)?.value);
  if (previous && previous.e === email && now - previous.s < RESEND_AFTER_S) {
    const wait = RESEND_AFTER_S - (now - previous.s);
    return NextResponse.json({ error: `A code was sent a moment ago. Wait ${wait}s, then ask for another.` }, { status: 429 });
  }

  const code = newCode();
  const message = renderSignInEmail({
    code,
    email,
    logoUrl: process.env.EMAIL_LOGO_URL || `${request.nextUrl.origin}/nexraah-logo.png`,
  });
  try {
    await sendEmail({ to: email, ...message, refId: randomUUID() });
  } catch (e) {
    console.error('[sign-in] email failed:', (e as Error).message);
    return NextResponse.json({ error: 'The code could not be sent. Try again in a minute.' }, { status: 502 });
  }

  const response = NextResponse.json({ ok: true, expiresInS: CODE_TTL_S }, { headers: { 'Cache-Control': 'no-store' } });
  response.cookies.set(COOKIE_NAME, issueChallenge(secret, email, code, now), {
    httpOnly: true,
    secure: request.nextUrl.protocol === 'https:',
    sameSite: 'strict',
    path: '/api/sign-in',
    maxAge: CODE_TTL_S,
  });
  return response;
}
