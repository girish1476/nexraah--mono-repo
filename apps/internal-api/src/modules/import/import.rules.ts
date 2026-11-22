/**
 * Part 12 · Go-live import — the rules, as pure functions.
 *
 * Everything that decides whether a row may be written lives here and touches
 * no database, because these are the rules an operator will argue with and
 * they need to be readable and testable on their own. The service does the
 * transaction; this file does the judgement.
 *
 * One piece of vocabulary that matters, because the wire contract only has one
 * list. `rejects[]` is "rows that needed intervention", and it carries two
 * different outcomes:
 *
 *   - **rejected** — the row is not written. Something required is missing or
 *     contradictory and no safe default exists.
 *   - **adjusted** — the row IS written, with a value changed, and the report
 *     says which. `status = ACTIVE` on a vendor is the case this exists for:
 *     part 12's own "done when" requires the row to land at
 *     `PENDING_VERIFICATION` *and* the report to say so, so silently dropping
 *     it and silently importing it are both wrong.
 *
 * `rejected` on the batch counts the entries in `rejects[]`, which is what the
 * documented example shows — so it is a count of rows that needed a human to
 * look, not a count of rows that failed.
 */
import { dayOf } from '../../common/accounting-journal';

export const IMPORT_SETS = ['clients', 'vendors', 'opening-balances'] as const;
export type ImportSet = (typeof IMPORT_SETS)[number];

export function isImportSet(value: string): value is ImportSet {
  return (IMPORT_SETS as readonly string[]).includes(value);
}

export interface RejectNote {
  row: number;
  reason: string;
}

export interface ControlTotals {
  suppliedPaise: number;
  computedPaise: number;
  reconciles: boolean;
}

export interface DryRunReport {
  rowCount: number;
  rejects: RejectNote[];
  controlTotals: ControlTotals | null;
}

export interface ValidationResult {
  report: DryRunReport;
  /** The rows that will be written on commit. Never the rejected ones. */
  accepted: Record<string, unknown>[];
  /**
   * True when the file cannot be committed at all, whatever the operator
   * clicks — currently only an opening-balance control total that does not
   * reconcile, which part 12 says aborts the entire import.
   */
  aborted: boolean;
}

/* ---- ordering ----------------------------------------------------------- */

/** What must already exist before a set may be imported (part 12 §4). */
export interface ExistingCounts {
  clients: number;
  vendors: number;
}

/**
 * The three sets are dependent. Clients first, because a rate card lane needs
 * the synthetic RFQ lane to point at; then vendors; then opening balances,
 * which reference both.
 */
export function missingDependencies(set: ImportSet, existing: ExistingCounts): string[] {
  const missing: string[] = [];
  if (set === 'vendors' || set === 'opening-balances') {
    if (existing.clients === 0) missing.push('clients');
  }
  if (set === 'opening-balances') {
    if (existing.vendors === 0) missing.push('vendors');
  }
  return missing;
}

/* ---- helpers ------------------------------------------------------------ */

/** CSV row 1 is the header, so a data row at index 0 is row 2 to a human. */
const humanRow = (index: number) => index + 2;

/**
 * Read a cell by column name, treating "column absent from the header" and
 * "column present but blank" as the same thing: empty.
 *
 * Reading `row.advance_pct` directly gives `undefined` for a file that simply
 * does not carry that optional column, and `undefined !== ''` quietly turns
 * every "is this optional value set?" check into "yes, and it is invalid" —
 * which rejected every row of an otherwise good file.
 */
const cell = (row: Record<string, string>, name: string) => (row[name] ?? '').trim();

function intOrNull(raw: string): number | null {
  if (raw === '') return null;
  if (!/^-?\d+$/.test(raw)) return null;
  return Number(raw);
}

function missingColumns(row: Record<string, string>, required: string[]): string[] {
  return required.filter((c) => (row[c] ?? '') === '');
}

/* ---- clients ------------------------------------------------------------ */

const CLIENT_REQUIRED = ['code', 'name', 'billing_city', 'engagement'];
const LANE_COLUMNS = ['lane_origin', 'lane_destination', 'lane_truck_type', 'lane_rate_paise', 'lane_valid_from'];

function validateClients(rows: Record<string, string>[]): ValidationResult {
  const rejects: RejectNote[] = [];
  const accepted: Record<string, unknown>[] = [];
  const seenCodes = new Set<string>();

  rows.forEach((row, i) => {
    const at = humanRow(i);
    const missing = missingColumns(row, CLIENT_REQUIRED);
    if (missing.length > 0) {
      rejects.push({ row: at, reason: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
      return;
    }
    if (!['SPOT', 'CONTRACT'].includes(cell(row, 'engagement').toUpperCase())) {
      rejects.push({ row: at, reason: `engagement must be SPOT or CONTRACT, got "${cell(row, 'engagement')}"` });
      return;
    }
    if (seenCodes.has(cell(row, 'code'))) {
      rejects.push({ row: at, reason: `Duplicate client code "${cell(row, 'code')}" — already in this file` });
      return;
    }
    const creditDays = cell(row, 'credit_days') === '' ? 0 : intOrNull(cell(row, 'credit_days'));
    if (creditDays === null || creditDays < 0) {
      rejects.push({ row: at, reason: `credit_days must be a whole number of days, got "${cell(row, 'credit_days')}"` });
      return;
    }

    // Lane columns are optional as a group. Present-but-incomplete is a
    // mistake worth naming rather than a client imported without its rate.
    const laneCells = LANE_COLUMNS.filter((c) => (row[c] ?? '') !== '');
    let lane: Record<string, unknown> | null = null;
    if (laneCells.length > 0) {
      const laneMissing = LANE_COLUMNS.filter((c) => (row[c] ?? '') === '');
      if (laneMissing.length > 0) {
        rejects.push({ row: at, reason: `Rate card lane is incomplete — missing ${laneMissing.join(', ')}` });
        return;
      }
      const rate = intOrNull(cell(row, 'lane_rate_paise'));
      if (rate === null || rate <= 0) {
        rejects.push({ row: at, reason: `lane_rate_paise must be a positive whole number of paise, got "${cell(row, 'lane_rate_paise')}"` });
        return;
      }
      lane = {
        origin: cell(row, 'lane_origin'),
        destination: cell(row, 'lane_destination'),
        truckType: cell(row, 'lane_truck_type'),
        ratePaise: rate,
        validFrom: cell(row, 'lane_valid_from'),
        validTo: cell(row, 'lane_valid_to') === '' ? null : cell(row, 'lane_valid_to'),
      };
    }

    seenCodes.add(cell(row, 'code'));
    accepted.push({
      code: cell(row, 'code'),
      name: cell(row, 'name'),
      billingCity: cell(row, 'billing_city'),
      engagement: cell(row, 'engagement').toUpperCase(),
      gstin: cell(row, 'gstin') || null,
      contact: cell(row, 'contact') || null,
      phone: cell(row, 'phone') || null,
      email: cell(row, 'email') || null,
      agreementNo: cell(row, 'agreement_no') || null,
      creditDays,
      serviceLevel: cell(row, 'service_level') || null,
      lane,
    });
  });

  return { report: { rowCount: rows.length, rejects, controlTotals: null }, accepted, aborted: false };
}

/* ---- vendors ------------------------------------------------------------ */

const VENDOR_REQUIRED = ['code', 'legal_name', 'party_type', 'base_city', 'phone'];
const TRUTHY = ['y', 'yes', 'true', '1'];

function validateVendors(rows: Record<string, string>[]): ValidationResult {
  const rejects: RejectNote[] = [];
  const accepted: Record<string, unknown>[] = [];
  const seenCodes = new Set<string>();
  const seenPhones = new Set<string>();

  rows.forEach((row, i) => {
    const at = humanRow(i);
    const missing = missingColumns(row, VENDOR_REQUIRED);
    if (missing.length > 0) {
      rejects.push({ row: at, reason: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
      return;
    }
    if (!['OWNER', 'VENDOR'].includes(cell(row, 'party_type').toUpperCase())) {
      rejects.push({ row: at, reason: `party_type must be OWNER or VENDOR, got "${cell(row, 'party_type')}"` });
      return;
    }
    if (seenCodes.has(cell(row, 'code'))) {
      rejects.push({ row: at, reason: `Duplicate vendor code "${cell(row, 'code')}" — already in this file` });
      return;
    }
    if (seenPhones.has(cell(row, 'phone'))) {
      rejects.push({ row: at, reason: `Duplicate phone number "${cell(row, 'phone')}"` });
      return;
    }
    // BR-03: no TDS declaration, no submission — whatever the party type. It
    // is held on file and nothing is deducted against it.
    if (!TRUTHY.includes((cell(row, 'tds_declaration') ?? '').toLowerCase())) {
      rejects.push({ row: at, reason: 'TDS declaration missing (BR-03)' });
      return;
    }
    const advancePct = cell(row, 'advance_pct') === '' ? null : intOrNull(cell(row, 'advance_pct'));
    if (cell(row, 'advance_pct') !== '' && (advancePct === null || advancePct < 0 || advancePct > 100)) {
      rejects.push({ row: at, reason: `advance_pct must be between 0 and 100, got "${cell(row, 'advance_pct')}"` });
      return;
    }

    /*
     * BR-01 is the gate the whole supply side hangs on, and it is not
     * bypassable by CSV. A file claiming ACTIVE does not fail — it lands at
     * PENDING_VERIFICATION and the report says so, so nobody believes a
     * transporter was cleared when they were not.
     */
    const claimed = (cell(row, 'status') || 'DRAFT').toUpperCase();
    let status = claimed;
    if (claimed !== 'DRAFT' && claimed !== 'PENDING_VERIFICATION') {
      status = 'PENDING_VERIFICATION';
      rejects.push({ row: at, reason: `status=${claimed} downgraded to PENDING_VERIFICATION (BR-01)` });
    }

    seenCodes.add(cell(row, 'code'));
    seenPhones.add(cell(row, 'phone'));
    accepted.push({
      code: cell(row, 'code'),
      legalName: cell(row, 'legal_name'),
      partyType: cell(row, 'party_type').toUpperCase(),
      baseCity: cell(row, 'base_city'),
      phone: cell(row, 'phone'),
      gstin: cell(row, 'gstin') || null,
      pan: cell(row, 'pan') || null,
      advancePct,
      bankAccount: cell(row, 'bank_account') || null,
      ifsc: cell(row, 'ifsc') || null,
      accountHolder: cell(row, 'account_holder') || null,
      status,
    });
  });

  return { report: { rowCount: rows.length, rejects, controlTotals: null }, accepted, aborted: false };
}

/* ---- opening balances --------------------------------------------------- */

const BALANCE_KINDS = ['ADVANCE', 'UNBILLED', 'INVOICE'];

/**
 * What an opening-balance file is checked against besides itself. The service
 * reads it from the database; the rules stay pure.
 */
export interface BalanceContext {
  /** Client code → id, as the client master stands now. */
  clients: Map<string, string>;
  /** Transporter code → id. */
  vendors: Map<string, string>;
  /** `KIND:REFERENCE` (upper case) already carried in by an earlier batch. */
  existing: Set<string>;
  /** Today as `YYYY-MM-DD` — an `ageing_days` figure is counted back from it. */
  today: string;
}

/** `YYYY-MM-DD` that many days before `day`. */
function daysBefore(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which party a kind belongs to. An open invoice and an unbilled trip are owed
 * by a client; an advance sits with the transporter it was paid to.
 */
const partyOf = (kind: string) => (kind === 'ADVANCE' ? 'transporter' : 'client');

function validateOpeningBalances(rows: Record<string, string>[], ctx: BalanceContext): ValidationResult {
  const rejects: RejectNote[] = [];
  const accepted: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let supplied: number | null = null;
  let computed = 0;
  let dataRows = 0;
  let badRows = 0;

  rows.forEach((row, i) => {
    const at = humanRow(i);
    const kind = cell(row, 'kind').toUpperCase();
    const amount = intOrNull(cell(row, 'amount_paise'));

    if (kind === 'CONTROL_TOTAL') {
      if (amount === null) {
        rejects.push({ row: at, reason: `Control total amount_paise is not a whole number, got "${cell(row, 'amount_paise')}"` });
        return;
      }
      if (supplied !== null) {
        rejects.push({ row: at, reason: 'More than one CONTROL_TOTAL row — the file must supply exactly one' });
        return;
      }
      supplied = amount;
      return;
    }

    dataRows += 1;
    const reject = (reason: string) => {
      badRows += 1;
      rejects.push({ row: at, reason });
    };
    if (!BALANCE_KINDS.includes(kind)) {
      return reject(`kind must be one of ${BALANCE_KINDS.join(', ')} or CONTROL_TOTAL, got "${cell(row, 'kind')}"`);
    }
    const reference = cell(row, 'reference');
    if (reference === '') return reject('Missing required column: reference');
    if (amount === null || amount <= 0) {
      return reject(`amount_paise must be a whole number of paise above zero, got "${cell(row, 'amount_paise')}"`);
    }

    const key = `${kind}:${reference.toUpperCase()}`;
    if (seen.has(key)) return reject(`${kind} ${reference} appears twice in this file`);
    seen.add(key);
    if (ctx.existing.has(key)) return reject(`${kind} ${reference} was already carried in by an earlier import`);

    // Whose balance it is. Without this a line is an amount with nobody to
    // collect it from or settle it against.
    const party = partyOf(kind);
    const partyCode = cell(row, 'party_code');
    if (partyCode === '') return reject(`Missing required column: party_code (the ${party} code for a ${kind} line)`);
    const partyId = (kind === 'ADVANCE' ? ctx.vendors : ctx.clients).get(partyCode.toUpperCase());
    if (!partyId) return reject(`No ${party} with code "${partyCode}" — import or add the ${party} first`);

    // Since when — ageing is the other half of what part 12 asks this set for.
    let dated: string | null = null;
    if (cell(row, 'dated') !== '') {
      dated = dayOf(cell(row, 'dated'));
      if (!dated) return reject(`dated must be a date such as 2026-10-05 or 05/10/2026, got "${cell(row, 'dated')}"`);
    } else if (cell(row, 'ageing_days') !== '') {
      const ageing = intOrNull(cell(row, 'ageing_days'));
      if (ageing === null || ageing < 0) return reject(`ageing_days must be a whole number of days, got "${cell(row, 'ageing_days')}"`);
      dated = daysBefore(ctx.today, ageing);
    } else {
      return reject('Give either dated (the invoice, trip or advance date) or ageing_days');
    }
    if (dated > ctx.today) return reject(`dated ${dated} is in the future`);

    computed += amount;
    accepted.push({
      kind,
      reference,
      partyCode,
      clientId: kind === 'ADVANCE' ? null : partyId,
      vendorId: kind === 'ADVANCE' ? partyId : null,
      amountPaise: amount,
      dated,
    });
  });

  if (supplied === null) {
    // Without a control total there is nothing to reconcile against, and part
    // 12 makes reconciliation the point of this set — so the file is not
    // committable rather than committable-but-unchecked.
    rejects.push({ row: 0, reason: 'No CONTROL_TOTAL row — an opening-balance file must supply one to reconcile against' });
    return {
      report: { rowCount: dataRows, rejects, controlTotals: null },
      accepted: [],
      aborted: true,
    };
  }

  const reconciles = supplied === computed;
  // Money is all or nothing: a balance line that cannot be written is money
  // the books say is owed and Nexraah would not show, so one bad line stops
  // the file even when the remaining lines happen to add up to the total.
  const aborted = !reconciles || badRows > 0;
  return {
    report: {
      rowCount: dataRows,
      rejects,
      controlTotals: { suppliedPaise: supplied, computedPaise: computed, reconciles },
    },
    // Nothing is carried forward from an aborted file, so a commit cannot
    // write a subset of one that did not add up.
    accepted: aborted ? [] : accepted,
    aborted,
  };
}

/* ---- entry point -------------------------------------------------------- */

const NO_CONTEXT: BalanceContext = { clients: new Map(), vendors: new Map(), existing: new Set(), today: '9999-12-31' };

export function validate(set: ImportSet, rows: Record<string, string>[], ctx: BalanceContext = NO_CONTEXT): ValidationResult {
  if (set === 'clients') return validateClients(rows);
  if (set === 'vendors') return validateVendors(rows);
  return validateOpeningBalances(rows, ctx);
}
