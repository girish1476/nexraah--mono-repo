/**
 * Money leaving the console for the books, and the bank's word against it.
 *
 * Two of the integrations the FSD lists (B7) that need no outside account:
 *
 *   - the accounting export — issued invoices, receipts and released
 *     payments as a double-entry journal file the accounting system imports.
 *     One way only: Nexraah is not the books of account (FSD B1);
 *   - the bank-statement check — every released payment's UTR looked for in
 *     the bank's own statement, so a mis-keyed UTR (the failure that actually
 *     happens, BR-09) is caught.
 *
 * Plain functions: the screens call them, the tests call them, and the
 * statement never leaves the browser it was opened in.
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

/* ---- the bank statement ------------------------------------------------------- */

/** One CSV text as rows of cells; quoted cells may hold commas, quotes and line breaks. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

export interface StatementLine {
  /** Row number in the file, counting from 1 — to find it again. */
  row: number;
  date: string | null;
  text: string;
  debitPaise: number;
}

/** "1,23,456.00", "₹ 500", "(250.00)" → paise; blank or not a number → 0. */
function paiseOf(cell: string | undefined): number {
  const s = String(cell ?? '').replace(/[₹,\s]|INR|Rs\.?/gi, '');
  const n = Number(s.replace(/^\((.*)\)$/, '$1'));
  return Number.isFinite(n) ? Math.round(Math.abs(n) * 100) : 0;
}

export class StatementUnreadable extends Error {}

/**
 * The money that left the account, from a bank statement saved as CSV. The
 * heading row is found by its words, so the statements of most Indian banks
 * read as they are downloaded: a description column (Narration, Description,
 * Particulars, Remarks) and either a withdrawal column (Withdrawal, Debit) or
 * an amount column with a Dr/Cr column beside it.
 */
export function readStatement(text: string): StatementLine[] {
  const rows = csvRows(text);
  const find = (cells: string[], re: RegExp, not?: RegExp) => cells.findIndex((c) => re.test(c) && !(not && not.test(c)));
  for (let h = 0; h < Math.min(rows.length, 40); h++) {
    const cells = rows[h].map((c) => c.trim().toLowerCase());
    const desc = find(cells, /narration|description|particulars|remarks|details/);
    if (desc < 0) continue;
    const debit = find(cells, /withdrawal|debit|^dr\b/, /credit|cr\s*\/\s*dr|dr\s*\/\s*cr/);
    const amount = find(cells, /^amount|txn amount|transaction amount/);
    const drcr = find(cells, /dr\s*\/\s*cr|cr\s*\/\s*dr|^type$|debit\/credit/);
    if (debit < 0 && (amount < 0 || drcr < 0)) continue;
    const date = find(cells, /value date/) >= 0 ? find(cells, /value date/) : find(cells, /date/);
    const ref = find(cells, /ref|chq|cheque|utr/);
    const lines: StatementLine[] = [];
    for (let r = h + 1; r < rows.length; r++) {
      const row = rows[r];
      const paise = debit >= 0 ? paiseOf(row[debit]) : /^d/i.test(String(row[drcr] ?? '').trim()) ? paiseOf(row[amount]) : 0;
      if (!paise) continue;
      lines.push({
        row: r + 1,
        date: date >= 0 ? dayOf(row[date]) : null,
        text: [row[desc], ref >= 0 && ref !== desc ? row[ref] : ''].filter(Boolean).join(' · ').trim(),
        debitPaise: paise,
      });
    }
    return lines;
  }
  throw new StatementUnreadable(
    'No heading row was found. The statement needs a column for the description (Narration, Description or Particulars) and one for the money out (Withdrawal or Debit).',
  );
}

export interface PaymentToCheck {
  id: string;
  kind: string;
  tripCode: string | null;
  vendorName: string | null;
  utr: string | null;
  netPaise: number;
  valueDate: string | null;
}

export interface BankCheck {
  /** UTR found, same amount. */
  matched: { payment: PaymentToCheck; line: StatementLine }[];
  /** UTR found, a different amount — keyed against the wrong payment, or paid wrong. */
  amountDiffers: { payment: PaymentToCheck; line: StatementLine }[];
  /** Paid within the statement's dates, but its UTR is nowhere in it — most often a mis-keyed UTR. */
  notFound: PaymentToCheck[];
  /** Paid outside the statement's dates: this statement cannot say. */
  outside: PaymentToCheck[];
  /** Money out of the account that no released payment accounts for — rent, salaries, or a payment not recorded here. */
  notInConsole: StatementLine[];
  period: { from: string; to: string } | null;
}

const bare = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function checkAgainstStatement(payments: PaymentToCheck[], lines: StatementLine[]): BankCheck {
  const days = lines.map((l) => l.date).filter((d): d is string => !!d).sort();
  const period = days.length ? { from: days[0], to: days[days.length - 1] } : null;
  const used = new Set<StatementLine>();
  const out: BankCheck = { matched: [], amountDiffers: [], notFound: [], outside: [], notInConsole: [], period };

  for (const payment of payments) {
    const utr = bare(payment.utr ?? '');
    const line = utr.length >= 6 ? lines.find((l) => !used.has(l) && bare(l.text).includes(utr)) : undefined;
    if (line) {
      used.add(line);
      (line.debitPaise === payment.netPaise ? out.matched : out.amountDiffers).push({ payment, line });
      continue;
    }
    const day = dayOf(payment.valueDate);
    if (period && day && (day < period.from || day > period.to)) out.outside.push(payment);
    else out.notFound.push(payment);
  }
  out.notInConsole = lines.filter((l) => !used.has(l));
  return out;
}
