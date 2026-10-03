import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Supabase Auth "Send Email" hook — Supabase generates the one-time code and,
 * instead of mailing it itself, POSTs it here; we send it through Resend.
 *
 * The request is signed the Standard Webhooks way: HMAC-SHA256 over
 * `${webhook-id}.${webhook-timestamp}.${raw body}` with the hook's secret
 * (`v1,whsec_<base64>` as Supabase shows it), sent as `webhook-signature:
 * v1,<base64> [v1,<base64>…]`. Anything unsigned, mis-signed or stale is
 * refused — this endpoint must never become an open mail relay.
 */

/** A request older (or newer) than this is refused: a captured call cannot be replayed later. */
export const MAX_SKEW_SECONDS = 5 * 60;

export class HookSignatureError extends Error {}

function secretBytes(secret: string): Buffer {
  // Supabase shows the secret as `v1,whsec_<base64>`; accept it with or without the prefixes.
  const raw = secret.trim().replace(/^v1,/, '').replace(/^whsec_/, '');
  return Buffer.from(raw, 'base64');
}

export function verifyHookSignature(
  headers: { id?: string; timestamp?: string; signature?: string },
  rawBody: Buffer | string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) throw new HookSignatureError('Missing webhook headers.');
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) {
    throw new HookSignatureError('Webhook timestamp is missing or too far from server time.');
  }
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secretBytes(secret)).update(`${id}.${timestamp}.${body}`).digest();
  const offered = signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => Buffer.from(part.slice(3), 'base64'));
  const ok = offered.some((sig) => sig.length === expected.length && timingSafeEqual(sig, expected));
  if (!ok) throw new HookSignatureError('Webhook signature does not match.');
}

/** The part of Supabase's hook payload this endpoint uses. */
export interface SendEmailHookPayload {
  user?: { email?: string | null; new_email?: string | null };
  email_data?: { token?: string | null; email_action_type?: string | null };
}

/** The address and code to send, or why the payload cannot be sent. */
export function readHookPayload(payload: SendEmailHookPayload): { email: string; code: string } {
  const email = String(payload?.user?.email ?? '').trim().toLowerCase();
  const code = String(payload?.email_data?.token ?? '').trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('The hook payload has no usable email address.');
  if (!/^\d{6,10}$/.test(code)) throw new Error('The hook payload has no one-time code.');
  return { email, code };
}
