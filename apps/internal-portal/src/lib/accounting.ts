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

export {
  dayOf,
  journalLines,
  journalRows,
  JOURNAL_HEADERS,
  LEDGERS,
  type JournalInvoice,
  type JournalLine,
  type JournalPayment,
  type JournalReceipt,
} from '../../../internal-api/src/common/accounting-journal';
import { dayOf } from '../../../internal-api/src/common/accounting-journal';

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
