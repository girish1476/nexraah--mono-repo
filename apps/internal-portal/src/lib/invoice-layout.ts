import { InvoiceDetail, InvoiceStatus } from '@/app/invoices/types';

/**
 * What the invoice says, worked out once for both the printed page
 * (`/print/invoice/[invoiceId]`) and the downloaded PDF (`lib/invoice-pdf.ts`).
 *
 * Those two are drawn separately — one in HTML, one with jsPDF — and used to
 * disagree whenever a field was added to one and not the other. The layout is
 * still drawn twice, but the lines, the totals and the wording now come from
 * here, so they cannot say different things.
 *
 * The layout follows the company's own invoice: letterhead, INVOICE with its
 * number and paid state, who is billing whom, one table of items, the totals,
 * how to pay, the reverse-charge note, terms, a signature line and the footer.
 */

export const INVOICE_BRAND = 'NEXRAAH';
export const INVOICE_TAGLINE = 'Built to move. Born to deliver.';
export const INVOICE_WEBSITE = 'www.nexraah.com';
export const INVOICE_EMAIL = 'info@nexraah.com';
export const INVOICE_TERMS =
  'Confidentiality: Both parties agree to keep all business information and materials confidential.';

/** The letterhead's colours — navy for the rules, header row and footer; sky blue for the brand. */
export const INVOICE_NAVY = '#0b1540';
export const INVOICE_BLUE = '#2196e6';

export interface InvoiceLine {
  title: string;
  /** Smaller lines under the title — the route, the rate basis, the weight. */
  sub: string[];
  /** Blank for a line that is not a count of anything (a discount). */
  qty: string;
  amountPaise: number;
}

/** `30,531.30` — rupees and paise, Indian grouping, no symbol. */
export function amount(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `2026-09-03`, as the company's invoices carry their dates. */
export function isoDay(date: string | null | undefined): string {
  return date ? String(date).slice(0, 10) : '—';
}

const STATUS: Record<InvoiceStatus, { label: string; paid: boolean }> = {
  DRAFT: { label: 'DRAFT', paid: false },
  ISSUED: { label: 'UNPAID', paid: false },
  PART_PAID: { label: 'PARTIALLY PAID', paid: false },
  PAID: { label: 'PAID', paid: true },
  CANCELLED: { label: 'CANCELLED', paid: false },
};

export function invoiceStatus(status: InvoiceStatus): { label: string; paid: boolean } {
  return STATUS[status] ?? { label: status, paid: false };
}

/** The lorry receipts this invoice bills, as one line. */
export function lrNumbers(invoice: InvoiceDetail): string {
  const codes = invoice.trips.map((t) => t.lrCode ?? t.slipLrNo ?? null).filter(Boolean);
  return codes.length ? codes.join(', ') : '—';
}

/**
 * The table's rows. One "Transportation charges" row per load, then each other
 * charge that is not zero. The rows always add up to the invoice's sub total:
 * a single load carries the invoice's freight figure itself, and where several
 * loads' own freights do not add up to it (it was edited), the difference is
 * its own row rather than being hidden.
 */
export function invoiceLines(invoice: InvoiceDetail): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  const trips = invoice.trips ?? [];

  const tripLine = (t: InvoiceDetail['trips'][number], amountPaise: number): InvoiceLine => {
    const sub: string[] = [];
    if (t.lane) sub.push(t.lane.replace(/\s*(→|->)\s*/g, ' to '));
    if (t.ratePerTonnePaise) sub.push(`Freight Charges (${amount(t.ratePerTonnePaise).replace(/\.00$/, '')} per ton)`);
    if (t.loadedWeightTn) sub.push(`Loaded Weight (${t.loadedWeightTn}MT)`);
    return { title: `Transportation charges${t.vehicleNo ? ` (${t.vehicleNo})` : ''}`, sub, qty: '1', amountPaise };
  };

  if (trips.length === 1) {
    lines.push(tripLine(trips[0], invoice.freightPaise));
  } else if (trips.length > 1) {
    trips.forEach((t) => lines.push(tripLine(t, t.sellRatePaise)));
    const difference = invoice.freightPaise - trips.reduce((a, t) => a + t.sellRatePaise, 0);
    if (difference !== 0) lines.push({ title: 'Freight adjustment', sub: [], qty: '1', amountPaise: difference });
  } else if (invoice.freightPaise !== 0) {
    lines.push({ title: 'Transportation charges', sub: [], qty: '1', amountPaise: invoice.freightPaise });
  }

  const heads: [string, number][] = [
    ['Loading charges', invoice.loadingPaise],
    ['Unloading charges', invoice.unloadingPaise],
    ['Detention charges', invoice.detentionPaise],
    ['Other charges', invoice.otherPaise],
    ...(invoice.extraCharges ?? []).map((c): [string, number] => [c.label, c.amountPaise]),
  ];
  for (const [title, paise] of heads) {
    if (paise) lines.push({ title, sub: [], qty: '1', amountPaise: paise });
  }
  if (invoice.discountPaise > 0) lines.push({ title: 'Discount', sub: [], qty: '', amountPaise: -invoice.discountPaise });
  return lines;
}

export function invoiceTotals(invoice: InvoiceDetail) {
  const subTotalPaise = invoiceLines(invoice).reduce((a, l) => a + l.amountPaise, 0);
  return {
    subTotalPaise,
    roundOffPaise: invoice.roundOffPaise ?? 0,
    totalPaise: invoice.totalPaise,
    receivedPaise: invoice.receivedPaise ?? 0,
    duePaise: invoice.status === 'CANCELLED' ? 0 : Math.max(0, invoice.totalPaise - (invoice.receivedPaise ?? 0)),
  };
}

/** The company's bank details, one per line — the settings keep them as one line with dots between. */
export function bankLines(invoice: InvoiceDetail): string[] {
  const parts = String(invoice.company.bank ?? '')
    .split(/\s*[·|]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  return [`Name: ${invoice.company.name.toUpperCase()}`, ...parts];
}

/**
 * The note: who pays the GST (the client, under reverse charge), then the bank
 * details, then whatever was typed on the invoice itself.
 */
export function noteLines(invoice: InvoiceDetail): string[] {
  const lines = [
    `GST on Road Transportation service would be paid by ${invoice.clientName.toUpperCase()} on our behalf.`,
    'GST is payable on RCM. I.E. IGST(5%)',
    'Bank Details',
    ...bankLines(invoice),
  ];
  for (const extra of [invoice.details, invoice.notes]) {
    const text = String(extra ?? '').trim();
    if (text) lines.push(...text.split(/\r?\n/));
  }
  return lines;
}
