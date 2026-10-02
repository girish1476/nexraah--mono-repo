import { jsPDF } from 'jspdf';
import { InvoiceDetail } from '@/app/invoices/types';
import { barcodeBars } from './barcode-pattern';
import { fmtDate } from './format';

/**
 * A single downloadable copy of the tax invoice (part 08 §2.1) — meant to be
 * the same content as `/print/invoice/[invoiceId]`, built directly as a PDF
 * instead of relying on the browser's print-to-PDF dialog. jsPDF's built-in
 * fonts have no ₹ glyph and no → glyph, so money and lanes here read "Rs."
 * and "->" instead of the characters used on-screen (`clean()`, below) — that
 * part is a deliberate, permanent difference, not a bug to chase.
 *
 * The rest was not deliberate: this file is a hand-drawn duplicate of the
 * print page, not a shared renderer, so every field added to that page since
 * — the SAC code, the watermark, the editable signatory — had to be added
 * here separately, and had not been. "Download PDF" and the printed page
 * disagreed on all three until this pass. There is still no single source
 * for either; the next field added to one has to be added to the other by
 * hand, same as this one was.
 */

const rs = (paise: number | null | undefined): string => {
  if (paise === null || paise === undefined) return '-';
  return `Rs. ${new Intl.NumberFormat('en-IN').format(Math.round(paise / 100))}`;
};

/**
 * jsPDF's standard Helvetica font only covers WinAnsi — a lane like
 * "Gandhidham → Jaipur" renders as raw UTF-16 bytes, not an arrow, so every
 * dynamic string gets its typographic characters swapped for ASCII first
 * (mirrors the ₹ → "Rs." swap in `rs()` above).
 */
const clean = (s: string): string =>
  s
    .replace(/→/g, '->')
    .replace(/[–—]/g, '-')
    .replace(/[''']/g, "'")
    .replace(/[""]/g, '"')
    .replace(/·/g, '|');

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 15;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const RIGHT_X = MARGIN_X + CONTENT_W;

/**
 * A faint centred "NEXRAAH" behind the whole page, drawn first so everything
 * else paints over it — jsPDF has no CSS blend modes, so the print page's
 * trick (invert + multiply the actual logo image to fake a transparent mark
 * out of a solid-navy PNG) has no equivalent here. Large, light-grey,
 * rotated text is the standard fallback for exactly this case, and needs no
 * image processing to get right: nothing to invert, nothing that can pick up
 * a stray colour cast the way the HTML version briefly did.
 */
function watermark(doc: jsPDF): void {
  doc.saveGraphicsState();
  doc.setGState(doc.GState({ opacity: 0.07 }));
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(72);
  doc.setTextColor(80, 80, 80);
  doc.text('NEXRAAH', PAGE_W / 2, PAGE_H / 2, { align: 'center', angle: 35 });
  doc.restoreGraphicsState();
  doc.setTextColor(0, 0, 0);
}

export function downloadInvoicePdf(invoice: InvoiceDetail): void {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  watermark(doc);
  let y = 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(clean(invoice.company.name), MARGIN_X, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('TAX INVOICE', RIGHT_X, y - 4, { align: 'right' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(invoice.code ?? 'DRAFT', RIGHT_X, y + 1.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  y += 6;
  doc.text(clean(invoice.company.address), MARGIN_X, y);
  doc.text(`Dated ${fmtDate(invoice.invoiceDate)}  |  due ${fmtDate(invoice.dueDate)}`, RIGHT_X, y, { align: 'right' });
  y += 4.5;
  doc.text(`GSTIN ${invoice.company.gstin}  |  PAN ${invoice.company.pan}  |  CIN ${invoice.company.cin}`, MARGIN_X, y);
  // SAC — the GST service code for a goods transport agency's road transport
  // service (996511), same field and same placement as the printed page.
  doc.text(`SAC ${invoice.company.sac}`, RIGHT_X, y, { align: 'right' });

  if (invoice.code) {
    const narrow = 0.35;
    const { bars, width } = barcodeBars(invoice.code, narrow);
    const bcHeight = 7;
    const bcY = y + 3;
    const bcX = RIGHT_X - width;
    doc.setFillColor(0, 0, 0);
    bars.forEach((b) => doc.rect(bcX + b.x, bcY, Math.max(b.w, 0.08), bcHeight, 'F'));
  }

  y += 10;
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, y, RIGHT_X, y);
  y += 6;

  doc.setFontSize(7);
  doc.text('BILLED TO', MARGIN_X, y);
  y += 4.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(clean(invoice.clientName), MARGIN_X, y);
  doc.setFont('helvetica', 'normal');
  y += 4.5;
  doc.setFontSize(8);
  doc.text(`${clean(invoice.client?.billingCity ?? '-')}  |  GSTIN ${invoice.client?.gstin ?? '-'}`, MARGIN_X, y);
  y += 4;
  doc.line(MARGIN_X, y, RIGHT_X, y);
  y += 7;

  const cols: { label: string; w: number; right?: boolean }[] = [
    { label: 'LR', w: 26 },
    { label: 'Trip', w: 26 },
    { label: 'Lane', w: 64 },
    { label: 'Delivered', w: 26 },
    { label: 'Freight', w: CONTENT_W - 26 - 26 - 64 - 26, right: true },
  ];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  let cx = MARGIN_X;
  cols.forEach((c) => {
    if (c.right) doc.text(c.label, cx + c.w, y, { align: 'right' });
    else doc.text(c.label, cx, y);
    cx += c.w;
  });
  y += 1.5;
  doc.line(MARGIN_X, y, RIGHT_X, y);
  y += 5;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  invoice.trips.forEach((t) => {
    cx = MARGIN_X;
    const values = [t.lrCode ?? '-', t.code, clean(t.lane), fmtDate(t.deliveredAt), rs(t.sellRatePaise)];
    cols.forEach((c, i) => {
      const v = values[i];
      if (c.right) doc.text(v, cx + c.w, y, { align: 'right' });
      else doc.text(doc.splitTextToSize(v, c.w - 2)[0] ?? v, cx, y);
      cx += c.w;
    });
    y += 5.5;
  });

  y += 3;
  const heads: [string, number][] = [
    ['Freight', invoice.freightPaise],
    ['Loading', invoice.loadingPaise],
    ['Unloading', invoice.unloadingPaise],
    ['Detention', invoice.detentionPaise],
    ['Other', invoice.otherPaise],
    ...(invoice.extraCharges ?? []).map((c): [string, number] => [c.label, c.amountPaise]),
    ...(invoice.discountPaise > 0 ? ([['Discount', -invoice.discountPaise]] as [string, number][]) : []),
    ['Round off', invoice.roundOffPaise],
  ];
  const chargeLabelX = RIGHT_X - 65;
  doc.setFontSize(8.5);
  heads.forEach(([label, value]) => {
    doc.text(label, chargeLabelX, y);
    doc.text(rs(value), RIGHT_X, y, { align: 'right' });
    y += 5;
  });
  doc.setLineWidth(0.3);
  doc.line(chargeLabelX, y, RIGHT_X, y);
  y += 5.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Total', chargeLabelX, y);
  doc.text(rs(invoice.totalPaise), RIGHT_X, y, { align: 'right' });
  doc.setFont('helvetica', 'normal');

  y += 10;
  doc.setLineWidth(0.3);
  doc.rect(MARGIN_X, y, CONTENT_W, 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('GST PAYABLE BY RECIPIENT UNDER REVERSE CHARGE', MARGIN_X + 3, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('Section 9(3), CGST Act 2017. No tax has been charged on this invoice.', MARGIN_X + 3, y + 9.5);
  y += 20;

  doc.setFontSize(7);
  const terms =
    'Terms. Payment is due within the agreed credit period from the invoice date. Interest may be charged on ' +
    'overdue amounts. Any discrepancy must be notified in writing within seven days of receipt of this invoice. ' +
    `Bank details: ${clean(invoice.company.bank)}.`;
  const wrapped = doc.splitTextToSize(terms, CONTENT_W);
  doc.text(wrapped, MARGIN_X, y);
  y += wrapped.length * 3.4 + 22;

  // Company name above a blank space left for a pen signature, the title
  // below a rule under it — same layout and same editable
  // `config.company.signatory` field (default "Authorised Signatory") as
  // the printed page, rather than the fixed text this used to draw.
  doc.setFontSize(7.5);
  doc.text(`For ${clean(invoice.company.name)}`, RIGHT_X - 27.5, y, { align: 'center' });
  y += 14;
  doc.line(RIGHT_X - 55, y, RIGHT_X, y);
  y += 4;
  doc.text(clean(invoice.company.signatory), RIGHT_X - 27.5, y, { align: 'center' });

  doc.save(`${invoice.code ?? 'invoice-draft'}.pdf`);
}
