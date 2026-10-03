/**
 * The sign-in code email: one 6-digit code, valid for four minutes, on the
 * Nexraah brand. Rendered here (not in a Supabase template) so it is the same
 * email in every environment and is covered by tests.
 *
 * Both an HTML and a plain-text body go out: mail clients that block images or
 * HTML still show the code, and a text part is one of the things spam filters
 * look for in a legitimate transactional email.
 */

/** How long a code works. Supabase → Auth → Email OTP expiration must match (240 s). */
export const CODE_TTL_MINUTES = 4;

export interface SignInEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderSignInEmail(input: { code: string; email: string; logoUrl?: string | null }): SignInEmail {
  const code = input.code.replace(/\D/g, '');
  const email = escapeHtml(input.email);
  const spaced = code.split('').join(' ');
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="150" alt="Nexraah" style="display:block;width:150px;height:auto;border:0;margin:0 auto;" />`
    : `<div style="font-size:22px;font-weight:700;letter-spacing:6px;color:#ffffff;">NEXRAAH</div>`;

  const subject = `${code} is your Nexraah sign-in code`;

  const text = [
    'Nexraah — Operations console',
    '',
    `Your sign-in code: ${code}`,
    '',
    `Enter it on the Nexraah sign-in screen. It works once and expires in ${CODE_TTL_MINUTES} minutes.`,
    '',
    'Didn’t ask for this? Ignore this email — nobody can sign in without the code.',
    'Never share this code, not even with Nexraah staff.',
    '',
    `Sent to ${input.email} because a sign-in was requested for the Nexraah console.`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0b1a4a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(6,14,50,0.12);">
            <tr>
              <td align="center" style="background:#060e32;padding:28px 24px;">${logo}</td>
            </tr>
            <tr>
              <td style="padding:32px 32px 8px;">
                <p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#2196e6;font-weight:700;">Operations console</p>
                <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:#060e32;">Your sign-in code</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#3a4a72;">
                  Enter this code on the Nexraah sign-in screen. It works once and expires in
                  <strong>${CODE_TTL_MINUTES} minutes</strong>.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:0 32px 28px;">
                <div style="display:inline-block;padding:16px 28px;border-radius:12px;background:#f1f7ff;border:1px solid #cfe3fb;font-family:Consolas,'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:8px;color:#060e32;" aria-label="Code ${spaced}">${code}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 32px;">
                <p style="margin:0;font-size:13px;line-height:1.55;color:#5b6a8f;">
                  Didn’t ask for this? Ignore this email — nobody can sign in without the code, and it expires on its own.
                  Never share this code, not even with Nexraah staff.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f6f8fc;border-top:1px solid #e3e9f4;font-size:12px;line-height:1.5;color:#8090b0;">
                Sent to ${email} because a sign-in was requested for the Nexraah console.<br />
                Nexraah · Built to move. Born to deliver.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
