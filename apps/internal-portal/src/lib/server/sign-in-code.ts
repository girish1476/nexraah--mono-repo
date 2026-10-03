import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Real emailed sign-in codes for the console, with no database.
 *
 * The code is never stored. What is stored — in an HttpOnly cookie the page's
 * script cannot read — is a signed "challenge": who it was for, when it was
 * sent, when it stops working, how many wrong tries so far, and an HMAC of the
 * code. Checking a code recomputes that HMAC; the secret (SIGNIN_SECRET) never
 * leaves the server, so the cookie cannot be forged or edited.
 *
 * Who may sign in is the server's own list, SIGNIN_PEOPLE, so it holds on any
 * phone or computer — not just the browser where Admin added someone:
 *
 *   SIGNIN_PEOPLE="you@company.in=ADMIN=Your Name, ops@company.in=OPS"
 */

export const CODE_TTL_S = 240;
export const RESEND_AFTER_S = 60;
export const MAX_ATTEMPTS = 5;
export const COOKIE_NAME = 'nx_signin';

export const ROLE_CODES = ['OPS', 'COMPLIANCE', 'FINANCE', 'BD', 'LEADERSHIP', 'ADMIN', 'LOADING_SUPERVISOR'] as const;
export type SignInRole = (typeof ROLE_CODES)[number];

export interface Person {
  email: string;
  role: SignInRole;
  name: string;
}

export interface Challenge {
  /** email */
  e: string;
  /** sent at, epoch seconds */
  s: number;
  /** expires at, epoch seconds */
  x: number;
  /** wrong attempts so far */
  a: number;
  /** HMAC of the code, base64url */
  h: string;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Parses SIGNIN_PEOPLE. Malformed entries are skipped, not guessed at. */
export function parsePeople(raw: string | undefined): Person[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [emailRaw, roleRaw, ...nameParts] = entry.split('=').map((p) => p.trim());
      const email = (emailRaw ?? '').toLowerCase();
      const role = (roleRaw ?? '').toUpperCase() as SignInRole;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !ROLE_CODES.includes(role)) return [];
      const name = nameParts.join('=').trim() || email.split('@')[0];
      return [{ email, role, name }];
    });
}

export function findPerson(email: string, raw = process.env.SIGNIN_PEOPLE): Person | undefined {
  const key = email.trim().toLowerCase();
  return parsePeople(raw).find((p) => p.email === key);
}

export function newCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

function codeHash(secret: string, email: string, sentAt: number, code: string): string {
  return createHmac('sha256', secret).update(`code|${email}|${sentAt}|${code}`).digest('base64url');
}

function sign(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`challenge|${payload}`).digest('base64url');
}

export function issueChallenge(secret: string, email: string, code: string, now = Math.floor(Date.now() / 1000)): string {
  const challenge: Challenge = { e: email, s: now, x: now + CODE_TTL_S, a: 0, h: codeHash(secret, email, now, code) };
  return seal(secret, challenge);
}

export function seal(secret: string, challenge: Challenge): string {
  const payload = b64url(JSON.stringify(challenge));
  return `${payload}.${sign(secret, payload)}`;
}

/** The challenge in a cookie, or null when it is missing, edited or forged. */
export function openChallenge(secret: string, cookie: string | undefined): Challenge | null {
  if (!cookie) return null;
  const [payload, mac] = cookie.split('.');
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(secret, payload));
  const offered = Buffer.from(mac);
  if (expected.length !== offered.length || !timingSafeEqual(expected, offered)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Challenge;
    return typeof c.e === 'string' && typeof c.h === 'string' ? c : null;
  } catch {
    return null;
  }
}

export type CheckResult =
  | { ok: true }
  | { ok: false; reason: 'NO_CODE' | 'WRONG_EMAIL' | 'EXPIRED' | 'TOO_MANY' | 'WRONG_CODE'; next?: Challenge };

/** Checks a typed code against the challenge. A wrong code returns the challenge with one more attempt counted. */
export function checkCode(
  secret: string,
  challenge: Challenge | null,
  email: string,
  code: string,
  now = Math.floor(Date.now() / 1000),
): CheckResult {
  if (!challenge) return { ok: false, reason: 'NO_CODE' };
  if (challenge.e !== email.trim().toLowerCase()) return { ok: false, reason: 'WRONG_EMAIL' };
  if (now > challenge.x) return { ok: false, reason: 'EXPIRED' };
  if (challenge.a >= MAX_ATTEMPTS) return { ok: false, reason: 'TOO_MANY' };
  const expected = Buffer.from(codeHash(secret, challenge.e, challenge.s, code.replace(/\s+/g, '')));
  const offered = Buffer.from(challenge.h);
  if (expected.length === offered.length && timingSafeEqual(expected, offered)) return { ok: true };
  return { ok: false, reason: 'WRONG_CODE', next: { ...challenge, a: challenge.a + 1 } };
}

/** Real email is on when the secret, the people list and a mail service are all set. */
export function realEmailConfigured(): boolean {
  return (
    !!process.env.SIGNIN_SECRET &&
    process.env.SIGNIN_SECRET.length >= 16 &&
    parsePeople(process.env.SIGNIN_PEOPLE).length > 0 &&
    !!process.env.EMAIL_FROM &&
    !!(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY)
  );
}
