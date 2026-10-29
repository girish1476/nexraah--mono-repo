/**
 * Sends one email through Resend's HTTP API (https://resend.com — free tier:
 * 3,000 emails a month, 100 a day). The sender must be on a domain verified in
 * Resend (SPF and DKIM records), so the email arrives as the company's own and
 * not as spam.
 *
 * Env: RESEND_API_KEY, EMAIL_FROM (e.g. `Nexraah <no-reply@nexraah.in>`),
 * optional EMAIL_REPLY_TO.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Same key → Resend sends once, so a retried hook call never mails the code twice. */
  idempotencyKey?: string;
}

export class EmailNotConfiguredError extends Error {}

export async function sendWithResend(email: OutgoingEmail, fetchImpl: typeof fetch = fetch): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new EmailNotConfiguredError('Email is not configured: RESEND_API_KEY and EMAIL_FROM must both be set.');
  }
  const replyTo = process.env.EMAIL_REPLY_TO;
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(email.idempotencyKey ? { 'Idempotency-Key': email.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
      // A unique id per email stops Gmail from threading every code into one conversation.
      headers: email.idempotencyKey ? { 'X-Entity-Ref-ID': email.idempotencyKey } : undefined,
      tags: [{ name: 'category', value: 'sign_in_code' }],
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok) {
    throw new Error(`Resend refused the email (${response.status}): ${payload.message ?? 'no reason given'}`);
  }
  return { id: payload.id ?? '' };
}

/* ---- Brevo ------------------------------------------------------------------ */

/** `Name <addr@x>` → { name, email }; a bare address → { email }. */
function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  return m ? { ...(m[1] ? { name: m[1].replace(/^"|"$/g, '') } : {}), email: m[2] } : { email: from.trim() };
}

/**
 * The same email through Brevo (https://brevo.com — free tier: 300 a day).
 * Brevo needs no domain: the sender address is verified by clicking a link
 * Brevo emails to it, so a company without its own mail domain can send from
 * a verified address it already has. Env: BREVO_API_KEY, EMAIL_FROM.
 */
export async function sendWithBrevo(email: OutgoingEmail, fetchImpl: typeof fetch = fetch): Promise<{ id: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) {
    throw new EmailNotConfiguredError('Email is not configured: BREVO_API_KEY and EMAIL_FROM must both be set.');
  }
  const replyTo = process.env.EMAIL_REPLY_TO;
  const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      sender: parseSender(from),
      to: [{ email: email.to }],
      subject: email.subject,
      htmlContent: email.html,
      textContent: email.text,
      ...(replyTo ? { replyTo: parseSender(replyTo) } : {}),
      ...(email.idempotencyKey ? { headers: { 'X-Entity-Ref-ID': email.idempotencyKey } } : {}),
      tags: ['sign-in-code'],
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { messageId?: string; message?: string };
  if (!response.ok) {
    throw new Error(`Brevo refused the email (${response.status}): ${payload.message ?? 'no reason given'}`);
  }
  return { id: payload.messageId ?? '' };
}

/** Whichever service has a key: Brevo when BREVO_API_KEY is set, else Resend. */
export function sendSignInEmail(email: OutgoingEmail, fetchImpl: typeof fetch = fetch): Promise<{ id: string }> {
  return process.env.BREVO_API_KEY ? sendWithBrevo(email, fetchImpl) : sendWithResend(email, fetchImpl);
}
