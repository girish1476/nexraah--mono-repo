import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  CODE_TTL_S,
  COOKIE_NAME,
  RESEND_AFTER_S,
  issueChallenge,
  newCode,
  openChallenge,
  realEmailConfigured,
} from '@/lib/server/sign-in-code';
import { allowedPerson } from '@/lib/server/people-store';
import { renderSignInEmail } from '@/lib/server/sign-in-email';
import { sendEmail } from '@/lib/server/mailer';

export const dynamic = 'force-dynamic';

const NOT_ALLOWED = 'This email is not allowed to sign in. Ask an administrator to add it.';

/** What to do about a refused email, in words — then the mail service's own reason, trimmed. */
function sendFailureHint(reason: string): string {
  const r = reason.toLowerCase();
  const detail = `(${reason.slice(0, 220)})`;
  if (r.includes('unrecognised ip') || r.includes('unrecognized ip') || r.includes('ip address'))
    return `The mail service is blocking this server's address: in Brevo, open Security → Authorized IPs and switch the blocking off. ${detail}`;
  if (r.includes('key not found') || r.includes('api key') || r.includes('unauthorized') || r.includes('(401)'))
    return `The mail service did not accept the key: check BREVO_API_KEY, then redeploy. ${detail}`;
  if (r.includes('sender'))
    return `The sender address is not verified with the mail service: verify it in Brevo, and make EMAIL_FROM match it exactly. ${detail}`;
  if (r.includes('not yet activated') || r.includes('not activated') || r.includes('(403)'))
    return `The mail service account is not cleared to send yet: finish the account steps Brevo asks for. ${detail}`;
  return `Try again in a minute. ${detail}`;
}

/**
 * POST /api/sign-in/send { email } — emails a fresh 4-minute code to someone
 * allowed to sign in: on the server's own list (SIGNIN_PEOPLE), or added by an
 * administrator on the Users screen. Anyone else gets the same refusal, and no
 * email goes out: this is not an open mailer.
 */
export async function POST(request: NextRequest) {
  if (!realEmailConfigured()) {
    return NextResponse.json({ error: 'Email sign-in is not configured on this deployment.' }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as { email?: string };
  const email = String(body.email ?? '').trim().toLowerCase();
  let person;
  try {
    person = email ? await allowedPerson(email) : undefined;
  } catch (e) {
    console.error('[sign-in] people list failed:', (e as Error).message);
    return NextResponse.json({ error: 'Sign-in is not available right now. Try again in a minute.' }, { status: 502 });
  }
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
    const reason = (e as Error).message;
    console.error('[sign-in] email failed:', reason);
    // Only someone allowed to sign in gets this far, so the mail service's own
    // reason is shown to them: it is what whoever set the deployment up needs.
    return NextResponse.json(
      { error: `The code could not be sent. ${sendFailureHint(reason)}` },
      { status: 502 },
    );
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
