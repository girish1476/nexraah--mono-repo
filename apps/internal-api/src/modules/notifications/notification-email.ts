import type { Rendered } from './notification-events';

/**
 * A notification as an email — the same look as the sign-in code email
 * (`auth/sign-in-email.ts`): dark header with the logo, one heading, the
 * message, one button into the right screen. A plain-text part goes with it,
 * for mail clients that show no HTML and for spam filters that look for one.
 */

export interface NotificationEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function renderNotificationEmail(input: {
  rendered: Rendered;
  /** The full link — the site's address and the event's path. Null when no site address is set. */
  url: string | null;
  to: string;
  /** "Transporter portal" or "Operations console" — the line above the heading. */
  place: string;
  logoUrl?: string | null;
}): NotificationEmail {
  const { rendered, url, place } = input;
  const logo = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" width="150" alt="Nexraah" style="display:block;width:150px;height:auto;border:0;margin:0 auto;" />`
    : `<div style="font-size:22px;font-weight:700;letter-spacing:6px;color:#ffffff;">NEXRAAH</div>`;

  const text = [
    `Nexraah — ${place}`,
    '',
    rendered.title,
    '',
    rendered.body,
    ...(url ? ['', `Open: ${url}`] : []),
    '',
    `Sent to ${input.to} by Nexraah.`,
  ].join('\n');

  const button = url
    ? `<tr>
              <td align="center" style="padding:0 32px 28px;">
                <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 26px;border-radius:10px;background:#2196e6;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">Open</a>
              </td>
            </tr>`
    : '';

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light only" />
    <title>${escapeHtml(rendered.subject)}</title>
  </head>
  <body style="margin:0;padding:0;background:#eef2f9;font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:#0b1a4a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(rendered.body)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef2f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(6,14,50,0.12);">
            <tr>
              <td align="center" style="background:#060e32;padding:28px 24px;">${logo}</td>
            </tr>
            <tr>
              <td style="padding:32px 32px 20px;">
                <p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#2196e6;font-weight:700;">${escapeHtml(place)}</p>
                <h1 style="margin:0 0 12px;font-size:21px;line-height:1.3;color:#060e32;">${escapeHtml(rendered.title)}</h1>
                <p style="margin:0;font-size:15px;line-height:1.6;color:#3a4a72;">${escapeHtml(rendered.body)}</p>
              </td>
            </tr>
            ${button}
            <tr>
              <td style="padding:16px 32px;background:#f6f8fc;border-top:1px solid #e3e9f4;font-size:12px;line-height:1.5;color:#8090b0;">
                Sent to ${escapeHtml(input.to)} by Nexraah.<br />
                Nexraah · Built to move. Born to deliver.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject: rendered.subject, html, text };
}
