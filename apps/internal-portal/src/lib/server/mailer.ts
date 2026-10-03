/**
 * Sends one email through a free transactional email service, chosen by
 * which key is set:
 *
 *   BREVO_API_KEY  — Brevo (free: 300 emails a day). The sender address only
 *                    has to be verified by clicking a link Brevo emails to it;
 *                    no domain or DNS needed, so it is the quickest start.
 *   RESEND_API_KEY — Resend (free: 3,000 a month, 100 a day). Needs a domain
 *                    verified in Resend (DNS records) to mail anyone.
 *
 * EMAIL_FROM is the sender, e.g. `Nexraah <no-reply@nexraah.in>` — it must be
 * the verified sender (Brevo) or on the verified domain (Resend).
 * EMAIL_REPLY_TO is optional.
 *
 * Server-only: these keys never reach the browser (no NEXT_PUBLIC_ prefix).
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** A unique id per email: stops Gmail threading every code into one conversation. */
  refId?: string;
}

export function mailerConfigured(): boolean {
  return !!process.env.EMAIL_FROM && !!(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY);
}

/** `Name <addr@x>` → { name, email }; a bare address → { email }. */
export function parseSender(from: string): { name?: string; email: string } {
  const m = from.match(/^\s*(.*?)\s*<\s*([^>]+)\s*>\s*$/);
  return m ? { ...(m[1] ? { name: m[1].replace(/^"|"$/g, '') } : {}), email: m[2] } : { email: from.trim() };
}

export async function sendEmail(email: OutgoingEmail, fetchImpl: typeof fetch = fetch): Promise<void> {
  const from = process.env.EMAIL_FROM;
  const replyTo = process.env.EMAIL_REPLY_TO || undefined;
  if (!from) throw new Error('Email is not configured: EMAIL_FROM is not set.');

  // Test runs only: write the email to a file instead of sending it, so the
  // browser suite can read the code. Never set on a real deployment.
  if (process.env.EMAIL_TEST_OUTBOX && process.env.VERCEL !== '1') {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.EMAIL_TEST_OUTBOX, JSON.stringify({ from, ...email }) + '\n');
    return;
  }

  if (process.env.BREVO_API_KEY) {
    const sender = parseSender(from);
    const response = await fetchImpl('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender,
        to: [{ email: email.to }],
        subject: email.subject,
        htmlContent: email.html,
        textContent: email.text,
        ...(replyTo ? { replyTo: parseSender(replyTo) } : {}),
        ...(email.refId ? { headers: { 'X-Entity-Ref-ID': email.refId } } : {}),
        tags: ['sign-in-code'],
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(`Brevo refused the email (${response.status}): ${payload.message ?? 'no reason given'}`);
    }
    return;
  }

  if (process.env.RESEND_API_KEY) {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        ...(email.refId ? { 'Idempotency-Key': email.refId } : {}),
      },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        ...(email.refId ? { headers: { 'X-Entity-Ref-ID': email.refId } } : {}),
        tags: [{ name: 'category', value: 'sign_in_code' }],
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { message?: string };
      throw new Error(`Resend refused the email (${response.status}): ${payload.message ?? 'no reason given'}`);
    }
    return;
  }

  throw new Error('Email is not configured: set BREVO_API_KEY or RESEND_API_KEY.');
}
