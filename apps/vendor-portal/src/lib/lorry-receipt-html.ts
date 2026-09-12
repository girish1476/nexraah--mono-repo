import { code39 } from './code39';
import { dateTime, inr } from './format';
import type { LorryReceipt } from '@/app/trips/types';

/**
 * The lorry receipt as self-contained HTML — one definition, two renderers.
 *
 * The browser prints the page itself, but the vendor app cannot: Android's
 * WebView has no `window.print()`, so the app hands the document to
 * `expo-print` natively instead. `expo-print` renders a standalone HTML
 * string with no access to the app's stylesheet, which is why every rule
 * here is inline rather than in `globals.css`.
 *
 * Written as a string rather than as a second React tree deliberately. The
 * two renderers must produce the *same paper* — a transporter printing from
 * their phone and one printing from a browser are holding the same document
 * at a checkpost — and the surest way to guarantee that is to have one
 * definition rather than two that are expected to stay in step by hand.
 *
 * Everything here comes off `LorryReceipt`, which is the redacted vendor
 * payload. The client's rate, the margin and the sell figures never appear
 * in it, so they cannot reach paper that is handed to the receiving party
 * (vendor-specs `02-redaction-contract.md`).
 */

/**
 * Server-supplied strings go into markup here, so they are escaped. None of
 * these fields is user-authored today, but "today" is not a property worth
 * relying on in a function whose whole job is to build HTML.
 */
function esc(value: string | number): string {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function barcodeSvg(value: string): string {
  const { bars, width } = code39(value);
  const rects = bars
    .map((b) => `<rect x="${b.x}" y="0" width="${b.width}" height="60" fill="#000"/>`)
    .join('');
  return (
    `<svg viewBox="0 0 ${width} 60" preserveAspectRatio="none" class="lr-barcode" ` +
    `role="img" aria-label="Barcode ${esc(value)}">` +
    `<rect width="${width}" height="60" fill="#fff"/>${rects}</svg>`
  );
}

/** `LorryReceipt`'s several nullable fields (mirroring `PortalLorryReceiptDto`) print this rather than "null". */
const NOT_RECORDED = 'Not recorded';

function block(title: string, rows: [string, string][]): string {
  const body = rows
    .map(
      ([k, v]) =>
        `<div class="lr-row"><span class="muted">${esc(k)}</span><span>${esc(v)}</span></div>`,
    )
    .join('');
  return `<section class="lr-block"><h2>${esc(title)}</h2>${body}</section>`;
}

/** The document itself, without the surrounding page or the print controls. */
export function lorryReceiptBody(lr: LorryReceipt): string {
  return [
    `<header class="lr-head">`,
    `<div><h1>Lorry receipt</h1>`,
    `<p class="lr-no">${esc(lr.lrNo)}</p>`,
    `<p class="muted">Issued ${esc(dateTime(lr.issuedAt))}</p></div>`,
    barcodeSvg(lr.lrNo),
    `</header>`,

    block('The load', [
      ['Route', `${lr.originCity} → ${lr.destinationCity}`],
      ['Goods', lr.goods],
      ['Weight loaded', lr.weightKg === null ? NOT_RECORDED : `${lr.weightKg / 1000} MT`],
      ['Truck type', lr.truckType ?? NOT_RECORDED],
      ['Days allowed for the trip', lr.transitDays === null ? NOT_RECORDED : String(lr.transitDays)],
    ]),

    block('Vehicle and driver', [
      ['Vehicle', lr.vehicleRegistrationNo],
      ['Driver', lr.driverName ?? NOT_RECORDED],
      ['Driving licence', lr.driverLicenceNo ?? NOT_RECORDED],
    ]),

    block('E-way bill', [
      ['Number', lr.ewayBillNo ?? NOT_RECORDED],
      ['Valid until', lr.ewayValidUpto ? dateTime(lr.ewayValidUpto) : NOT_RECORDED],
    ]),

    block('Your freight on this load', [
      ['Agreed freight', inr(lr.freightPaise)],
      ['Advance paid to you', `−${inr(lr.advancePaise)}`],
      ['Balance, paid on proof of delivery', inr(lr.balancePaise)],
    ]),

    // The signature the document exists to collect. Without a ruled space
    // for it the printed copy comes back unsigned, and an unsigned copy does
    // not stop the POD clock.
    `<section class="lr-signs">`,
    `<div><span>Received the goods in good condition</span><div class="lr-rule"></div>`,
    `<span class="muted">Receiver&#39;s signature, name and stamp</span></div>`,
    `<div><span>Date and time of delivery</span><div class="lr-rule"></div>`,
    `<span class="muted">To be filled in at delivery</span></div>`,
    `</section>`,

    `<p class="lr-foot">Get this signed copy to the branch within 20 days of delivery. `,
    `Photographing it in the app starts the check, but only the paper landing at the branch `,
    `stops the days counting.</p>`,
  ].join('');
}

/**
 * Inline copy of the print rules, for renderers that never see
 * `globals.css` — which is every renderer except the browser showing the
 * page. Kept deliberately small: this is a black-on-white document that has
 * to survive a photocopier, not a themed screen.
 */
const INLINE_STYLES = `
  body { margin: 0; padding: 16px; background: #fff; color: #000;
         font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .muted { color: #555; }
  .lr-head { display: flex; gap: 20px; align-items: flex-start;
             justify-content: space-between; border-bottom: 2px solid #000;
             padding-bottom: 12px; margin-bottom: 16px; }
  .lr-head h1 { font-size: 17px; margin: 0 0 4px; text-transform: uppercase;
                letter-spacing: 0.06em; }
  .lr-no { font-family: ui-monospace, Menlo, monospace; font-size: 22px;
           letter-spacing: 1px; margin: 0; }
  .lr-barcode { width: 260px; height: 60px; display: block; flex: none; }
  .lr-block { margin-bottom: 14px; break-inside: avoid; }
  .lr-block h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.07em;
                 margin: 0 0 6px; padding-bottom: 4px; border-bottom: 1px solid #999; }
  .lr-row { display: flex; justify-content: space-between; gap: 16px;
            padding: 5px 0; font-size: 14px; }
  .lr-signs { display: flex; gap: 28px; margin-top: 28px; break-inside: avoid; }
  .lr-signs > div { flex: 1; font-size: 12px; }
  .lr-rule { border-bottom: 1px solid #000; height: 44px; margin: 2px 0 4px; }
  .lr-foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #999;
             font-size: 12px; line-height: 1.5; }
  @page { size: A4; margin: 14mm; }
`;

/** A complete, standalone document — what gets handed to `expo-print`. */
export function lorryReceiptDocument(lr: LorryReceipt): string {
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<title>${esc(lr.lrNo)}</title>`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${INLINE_STYLES}</style></head><body>`,
    lorryReceiptBody(lr),
    '</body></html>',
  ].join('');
}
