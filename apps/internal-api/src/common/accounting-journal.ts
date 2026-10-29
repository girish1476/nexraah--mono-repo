/**
 * The accounting journal — issued invoices, receipts and released payments as
 * balanced double-entry lines for the books (FSD B7, part 13 §2: one-way export;
 * Nexraah is not the books of account).
 *
 * Plain functions, shared: the API's GET /accounting/journal builds the lines
 * here, and the console imports this same file (apps/internal-portal/src/lib/accounting.ts)
 * for the browser-only demo and the file it writes.
 */

/* ---- dates ------------------------------------------------------------------- */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** A day as `YYYY-MM-DD` from the ways banks write one: 2026-10-05, 05/10/2026, 05-10-26, 05 Oct 2026, 05-Oct-26. */
export function dayOf(text: string | null | undefined): string | null {
  const s = String(text ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const year = (y: string) => (y.length === 2 ? `20${y}` : y);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})\b/);
  if (m) return `${year(m[3])}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[\s/-]([A-Za-z]{3})[A-Za-z]*[\s/-](\d{2}|\d{4})\b/);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase());
    if (month >= 0) return `${year(m[3])}-${String(month + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return null;
}

/* ---- the accounting journal --------------------------------------------------- */

export interface JournalInvoice {
  code: string;
  clientName: string;
  invoiceDate: string;
  totalPaise: number;
  status: string;
}
export interface JournalReceipt {
  code: string;
  invoiceCode: string;
  clientName: string;
  receivedOn: string;
  amountPaise: number;
  mode?: string | null;
  reference?: string | null;
}
export interface JournalPayment {
  kind: string;
  tripCode: string | null;
  vendorName: string | null;
  netPaise: number;
  utr?: string | null;
  valueDate?: string | null;
  releasedAt?: string | null;
}

export interface JournalLine {
  date: string;
  voucherType: 'Sales' | 'Receipt' | 'Payment';
  voucherNo: string;
  ledger: string;
  debitPaise: number;
  creditPaise: number;
  narration: string;
}

/** The ledgers the journal posts to besides each client's and transporter's own. Renamed in the books if they differ. */
export const LEDGERS = { income: 'Freight income', bank: 'Bank' } as const;

/**
 * Every issued invoice, receipt and released payment dated within [from, to],
 * as balanced journal lines — each voucher one debit and one credit of the
 * same amount. Cancelled and draft invoices are left out.
 */
export function journalLines(
  { invoices, receipts, payments }: { invoices: JournalInvoice[]; receipts: JournalReceipt[]; payments: JournalPayment[] },
  from: string,
  to: string,
): JournalLine[] {
  const within = (d: string | null) => !!d && d >= from && d <= to;
  const lines: JournalLine[] = [];
  const pair = (date: string, voucherType: JournalLine['voucherType'], voucherNo: string, debit: string, credit: string, paise: number, narration: string) => {
    if (paise <= 0) return;
    lines.push({ date, voucherType, voucherNo, ledger: debit, debitPaise: paise, creditPaise: 0, narration });
    lines.push({ date, voucherType, voucherNo, ledger: credit, debitPaise: 0, creditPaise: paise, narration });
  };

  for (const inv of invoices) {
    const date = dayOf(inv.invoiceDate);
    if (!within(date) || inv.status === 'DRAFT' || inv.status === 'CANCELLED') continue;
    pair(date!, 'Sales', inv.code, inv.clientName, LEDGERS.income, inv.totalPaise, `Freight billed · ${inv.code}`);
  }
  for (const r of receipts) {
    const date = dayOf(r.receivedOn);
    if (!within(date)) continue;
    const how = [r.mode, r.reference].filter(Boolean).join(' ');
    pair(date!, 'Receipt', r.code, LEDGERS.bank, r.clientName, r.amountPaise, `Received against ${r.invoiceCode}${how ? ` · ${how}` : ''}`);
  }
  for (const p of payments) {
    const date = dayOf(p.valueDate) ?? dayOf(p.releasedAt);
    if (!within(date)) continue;
    const what = p.kind === 'ADVANCE' ? 'Advance' : 'Balance';
    pair(
      date!,
      'Payment',
      `${what.toUpperCase()}-${p.tripCode ?? '?'}`,
      p.vendorName ?? 'Transporter',
      LEDGERS.bank,
      p.netPaise,
      `${what} for trip ${p.tripCode ?? ''}${p.utr ? ` · UTR ${p.utr}` : ''}`.replace(/\s+·/, ' ·'),
    );
  }
  return lines.sort((a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo));
}

/** The journal file's columns — the common shape accounting systems import (Tally through an Excel import, Zoho Books, Busy). */
export const JOURNAL_HEADERS = ['Date', 'Voucher type', 'Voucher no', 'Ledger', 'Debit', 'Credit', 'Narration'];

export function journalRows(lines: JournalLine[]): (string | number | null)[][] {
  const rupees = (p: number) => (p ? (p / 100).toFixed(2) : null);
  return lines.map((l) => [l.date, l.voucherType, l.voucherNo, l.ledger, rupees(l.debitPaise), rupees(l.creditPaise), l.narration]);
}
