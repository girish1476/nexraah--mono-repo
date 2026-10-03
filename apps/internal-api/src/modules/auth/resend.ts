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
