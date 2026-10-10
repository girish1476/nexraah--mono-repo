import { jsPDF } from 'jspdf';
import { InvoiceDetail } from '@/app/invoices/types';
import {
  INVOICE_BRAND,
  INVOICE_EMAIL,
  INVOICE_TAGLINE,
  INVOICE_TERMS,
  INVOICE_WEBSITE,
  addressLines,
  addressOneLine,
  amount,
  billToLines,
  companyExtraLines,
  invoiceLines,
  invoiceStatus,
  invoiceTotals,
  isoDay,
  lrNumbers,
  noteLines,
} from './invoice-layout';

/**
 * A downloadable copy of the invoice (part 08 §2.1) — the same content and the
 * same layout as `/print/invoice/[invoiceId]`, built directly as a PDF instead
 * of relying on the browser's print-to-PDF dialog.
 *
 * What it says (the item rows, totals, note, wording) comes from
 * `invoice-layout.ts`, shared with the printed page. Only the drawing is done
 * twice. jsPDF's built-in fonts have no ₹ glyph and no → glyph, so money here
 * reads "Rs." and typographic characters are swapped for plain ones
 * (`clean()`, below) — a deliberate, permanent difference, not a bug to chase.
 *
 * An invoice is one page. It is drawn at its normal spacing first and, where
 * that runs over (a long note, several loads), drawn again with the gaps
 * between its blocks closed up. Only an invoice too long for that runs on.
 */

/**
 * jsPDF's standard Helvetica font only covers WinAnsi — an arrow or a rupee
 * sign renders as raw bytes, so every dynamic string gets its typographic
 * characters swapped for ASCII first.
 */
const clean = (s: string): string =>
  String(s ?? '')
    .replace(/→/g, '->')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₹/g, 'Rs. ')
    .replace(/·/g, '|');

const rs = (paise: number): string => `Rs. ${amount(paise)}`;

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = 15;
const CONTENT_W = PAGE_W - MARGIN_X * 2;
const RIGHT_X = MARGIN_X + CONTENT_W;
const FOOTER_H = 15;
const FOOTER_Y = PAGE_H - 10 - FOOTER_H;

const NAVY: [number, number, number] = [11, 21, 64];
const BLUE: [number, number, number] = [33, 150, 230];
const INK: [number, number, number] = [17, 17, 17];

/** The logo as a data URL, or null when it cannot be fetched — the invoice is still drawn without it. */
async function loadLogo(): Promise<string | null> {
  try {
    const response = await fetch('/nexraah-logo-print.png');
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** The navy band at the foot of every page: website and email, then the address. */
function footer(doc: jsPDF, invoice: InvoiceDetail): void {
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN_X, FOOTER_Y, CONTENT_W, FOOTER_H, 'F');
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.8);
  doc.line(MARGIN_X, FOOTER_Y, RIGHT_X, FOOTER_Y);
  doc.setTextColor(255, 255, 255);
  doc.setFont('times', 'bold');
  doc.setFontSize(9.5);
  doc.text(`${INVOICE_WEBSITE}     |     ${INVOICE_EMAIL}`, PAGE_W / 2, FOOTER_Y + 6, { align: 'center' });
  doc.setFont('times', 'normal');
  doc.setFontSize(8.5);
  doc.text(clean(addressOneLine(invoice.company.address)), PAGE_W / 2, FOOTER_Y + 11, { align: 'center' });
  doc.setTextColor(...INK);
  doc.setDrawColor(0, 0, 0);
}

/** Draws the whole invoice. `tight` closes up the gaps between its blocks. */
function draw(invoice: InvoiceDetail, logo: string | null, tight: boolean): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const { company } = invoice;
  const status = invoiceStatus(invoice.status);
  const lines = invoiceLines(invoice);
  const totals = invoiceTotals(invoice);
  const gap = (mm: number) => (tight ? mm * 0.45 : mm);
  let y = 0;

  /** Starts a new page when the next block would run into the footer band. */
  const room = (needed: number) => {
    if (y + needed <= FOOTER_Y - 6) return;
    doc.addPage();
    y = 20;
  };

  // ---- letterhead, with INVOICE, its number and whether it is paid ----------
  // 400 × 471 px, drawn 30 mm tall.
  if (logo) doc.addImage(logo, 'PNG', MARGIN_X + 2, 10, 25.5, 30);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);
  doc.text(clean(company.name).toUpperCase(), RIGHT_X, 16.5, { align: 'right' });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  doc.text(INVOICE_TAGLINE, RIGHT_X, 21.5, { align: 'right' });
  const taglineWidth = doc.getTextWidth(INVOICE_TAGLINE);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...BLUE);
  doc.text(INVOICE_BRAND, RIGHT_X - taglineWidth - 2.5, 21.5, { align: 'right' });

  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('INVOICE', RIGHT_X, 31.5, { align: 'right' });
  doc.setFontSize(8.5);
  doc.text(`# ${invoice.code ?? 'DRAFT'}`, RIGHT_X, 36, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  if (status.paid) doc.setTextColor(22, 128, 60);
  else doc.setTextColor(224, 58, 58);
  doc.text(status.label, RIGHT_X, 40, { align: 'right' });
  doc.setTextColor(...INK);

  doc.setDrawColor(...NAVY);
  doc.setLineWidth(1.1);
  doc.line(MARGIN_X, 45, RIGHT_X, 45);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.2);
  doc.line(MARGIN_X, 48.5, RIGHT_X, 48.5);
  doc.setDrawColor(0, 0, 0);

  // ---- who is billing whom --------------------------------------------------
  const LEAD = 4.4;
  const TOP = 57;
  let left = TOP;
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text(clean(company.name), MARGIN_X + 3, left);
  doc.setFont('helvetica', 'normal');
  left += LEAD;
  const leftLines = [...addressLines(company.address), `GST Number: ${company.gstin}`, ...companyExtraLines(company)];
  for (const text of leftLines) {
    for (const line of doc.splitTextToSize(clean(text), 88) as string[]) {
      doc.text(line, MARGIN_X + 3, left);
      left += LEAD;
    }
  }

  let right = TOP;
  const rightLine = (text: string, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.text(clean(text), RIGHT_X - 3, right, { align: 'right' });
    right += LEAD;
  };
  rightLine('Bill To:', true);
  rightLine(invoice.clientName, true);
  // The address may be long: it is wrapped to the block's width, each line right-aligned.
  for (const line of billToLines(invoice)) {
    for (const wrapped of doc.splitTextToSize(clean(line), 84) as string[]) rightLine(wrapped);
  }
  right += gap(3);
  rightLine(`Invoice Date: ${isoDay(invoice.invoiceDate)}`);
  rightLine(`Due Date: ${isoDay(invoice.dueDate)}`);
  // The invoice's own SAC when one was set on the edit screen, else the company's.
  rightLine(`SAC Code: ${invoice.sacCode || company.sac}`);
  rightLine(`LR Number: ${lrNumbers(invoice)}`);

  // ---- the items ------------------------------------------------------------
  y = Math.max(left, right) - LEAD + gap(8);
  const COL = { no: MARGIN_X + 3, item: MARGIN_X + 12, qty: 126, rate: 153, tax: 167, amount: RIGHT_X - 3 };
  doc.setFillColor(...NAVY);
  doc.rect(MARGIN_X, y, CONTENT_W, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(9);
  doc.text('#', COL.no, y + 5.4);
  doc.text('Item', COL.item, y + 5.4);
  doc.text('Qty', COL.qty, y + 5.4, { align: 'center' });
  doc.text('Rate', COL.rate, y + 5.4, { align: 'right' });
  doc.text('Tax', COL.tax, y + 5.4, { align: 'center' });
  doc.text('Amount', COL.amount, y + 5.4, { align: 'right' });
  doc.setTextColor(...INK);
  y += 13.5;

  lines.forEach((l, i) => {
    const title = doc.splitTextToSize(clean(l.title), 92) as string[];
    room(title.length * 4.2 + l.sub.length * 3.9 + 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(String(i + 1), COL.no, y);
    doc.text(title, COL.item, y);
    doc.text(l.qty, COL.qty, y, { align: 'center' });
    doc.text(amount(l.amountPaise), COL.rate, y, { align: 'right' });
    doc.text('0%', COL.tax, y, { align: 'center' });
    doc.text(amount(l.amountPaise), COL.amount, y, { align: 'right' });
    y += title.length * 4.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(60, 60, 60);
    for (const s of l.sub) {
      doc.text(clean(s), COL.item, y);
      y += 3.9;
    }
    doc.setTextColor(...INK);
    y += gap(4);
  });

  // ---- totals ---------------------------------------------------------------
  y += gap(6);
  const totalRow = (label: string, paise: number, band: boolean) => {
    room(8);
    if (band) {
      doc.setFillColor(239, 239, 239);
      doc.rect(MARGIN_X, y - 4.8, CONTENT_W, 7, 'F');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(label, RIGHT_X - 34, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.text(rs(paise), RIGHT_X - 3, y, { align: 'right' });
    y += 7;
  };
  totalRow('Sub Total', totals.subTotalPaise, false);
  if (totals.roundOffPaise !== 0) totalRow('Round Off', totals.roundOffPaise, false);
  totalRow('Total', totals.totalPaise, true);
  if (totals.receivedPaise > 0) totalRow('Amount Received', totals.receivedPaise, false);
  totalRow('Amount Due', totals.duePaise, true);

  // ---- how to pay, the note, the terms ---------------------------------------
  const TEXT_X = MARGIN_X + 3;
  const heading = (text: string) => {
    room(10);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.text(text, TEXT_X, y);
    y += LEAD;
    doc.setFont('helvetica', 'normal');
  };
  const paragraph = (text: string) => {
    for (const line of doc.splitTextToSize(clean(text), CONTENT_W - 6) as string[]) {
      room(LEAD);
      doc.text(line, TEXT_X, y);
      y += LEAD;
    }
  };

  y += gap(6);
  heading('Offline Payment:');
  paragraph('Bank Transfer');
  y += gap(3);
  heading('Note:');
  noteLines(invoice).forEach(paragraph);
  y += gap(3);
  heading('Terms & Conditions:');
  paragraph(INVOICE_TERMS);
  y += gap(12);
  room(8);
  doc.text('Authorized Signature _________________________', TEXT_X, y);

  // The footer band goes on every page the invoice ran to.
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    footer(doc, invoice);
  }
  return doc;
}

/** The invoice as a PDF — on one page wherever it can be made to fit. */
export async function buildInvoicePdf(invoice: InvoiceDetail): Promise<jsPDF> {
  const logo = await loadLogo();
  const doc = draw(invoice, logo, false);
  return doc.getNumberOfPages() > 1 ? draw(invoice, logo, true) : doc;
}

export async function downloadInvoicePdf(invoice: InvoiceDetail): Promise<void> {
  const doc = await buildInvoicePdf(invoice);
  doc.save(`${invoice.code ?? 'invoice-draft'}.pdf`);
}
