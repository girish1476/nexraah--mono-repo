import { LEGAL_DOCUMENT_KINDS, type DocumentKind } from './vendors.constants';

/**
 * Vendor document expiry — the periodic audit the app never had.
 *
 * `vendor_documents.valid_to` has existed since the first migration. It is
 * captured at onboarding, displayed on the vendor's file ("Valid to"), and
 * **read by nothing**: no job, no gate, no query. So a transporter whose
 * trade licence or permit lapsed a year ago is still `ACTIVE`, still clears
 * BR-01 at award time, and keeps being given loads.
 *
 * That is the gap this closes. It is the highest-consequence one found in the
 * Finance audit, because the failure is not a wrong number on a screen — it is
 * goods moving on a vehicle whose paperwork we are asserting we checked.
 *
 * Pure and dependency-free on purpose, like `order-ladder.ts` and
 * `client-onboarding.ts`: the rule can then be tested without a database, and
 * the fixture adapter can mirror it without a second copy of the reasoning.
 */

/**
 * Documents whose validity is time-bound.
 *
 * Only the legal ones. A TDS declaration and a bank statement are point-in-time
 * records — they are held on file (BR-03/BR-33) and do not "expire" in a way
 * that should stop a truck. A trade licence, labour licence, RC or Udyam
 * registration genuinely lapses, and carrying against a lapsed one is the
 * exposure.
 */
export const EXPIRING_DOCUMENT_KINDS: DocumentKind[] = [...LEGAL_DOCUMENT_KINDS];

/** How far ahead Compliance is warned, so a renewal can be chased in time. */
export const EXPIRY_WARNING_DAYS = 30;

export type ExpiryState = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | 'NO_EXPIRY';

export interface VendorDocumentLike {
  kind: string;
  status: string;
  /** ISO date, or null when the document carries no expiry. */
  validTo: string | null;
}

export interface DocumentExpiry {
  kind: string;
  state: ExpiryState;
  validTo: string | null;
  /** Negative once past. Null when there is no expiry to count towards. */
  daysRemaining: number | null;
}

const DAY_MS = 86_400_000;

/** Whole days from `asOf` to `validTo`; negative once past. */
export function daysUntil(validTo: string, asOf: Date): number {
  const end = Date.parse(validTo);
  if (Number.isNaN(end)) return 0;
  // Both floored to a day boundary: a document valid *to* the 30th is valid
  // for the whole of the 30th, not until the moment of day-30 midnight.
  return Math.floor((end - Math.floor(asOf.getTime() / DAY_MS) * DAY_MS) / DAY_MS);
}

export function expiryStateOf(doc: VendorDocumentLike, asOf: Date): DocumentExpiry {
  if (!doc.validTo) {
    // A document with no expiry recorded is not treated as expired. Guessing
    // otherwise would suspend every vendor onboarded before the field was
    // filled in reliably — a rule that fires on absent data is a rule that
    // punishes bad record-keeping rather than lapsed paperwork.
    return { kind: doc.kind, state: 'NO_EXPIRY', validTo: null, daysRemaining: null };
  }

  const daysRemaining = daysUntil(doc.validTo, asOf);
  const state: ExpiryState =
    daysRemaining < 0 ? 'EXPIRED' : daysRemaining <= EXPIRY_WARNING_DAYS ? 'EXPIRING_SOON' : 'VALID';

  return { kind: doc.kind, state, validTo: doc.validTo, daysRemaining };
}

export interface VendorExpiryReport {
  expired: DocumentExpiry[];
  expiringSoon: DocumentExpiry[];
  /** True when at least one time-bound legal document has lapsed. */
  hasExpired: boolean;
  /** The soonest expiry still ahead, for sorting a chase queue. */
  soonestDaysRemaining: number | null;
}

/**
 * Which of a vendor's legal documents have lapsed, and which are about to.
 *
 * Only VERIFIED documents are considered. An unverified one is already caught
 * by BR-01 at activation, and reporting it here as well would tell Compliance
 * the same thing twice in two different queues.
 */
export function vendorExpiryReport(docs: VendorDocumentLike[], asOf: Date): VendorExpiryReport {
  const relevant = docs.filter(
    (d) => d.status === 'VERIFIED' && EXPIRING_DOCUMENT_KINDS.includes(d.kind as DocumentKind),
  );

  const states = relevant.map((d) => expiryStateOf(d, asOf));
  const expired = states.filter((s) => s.state === 'EXPIRED');
  const expiringSoon = states.filter((s) => s.state === 'EXPIRING_SOON');

  const ahead = states
    .filter((s) => s.daysRemaining !== null && s.daysRemaining >= 0)
    .map((s) => s.daysRemaining as number);

  return {
    expired,
    expiringSoon,
    hasExpired: expired.length > 0,
    soonestDaysRemaining: ahead.length > 0 ? Math.min(...ahead) : null,
  };
}

/**
 * Whether this vendor may be given *new* work today.
 *
 * Deliberately separate from `vendors.status`, and deliberately **not** an
 * auto-suspension. A certificate lapsing overnight must not strand loads that
 * are already moving, and flipping a vendor to SUSPENDED by a nightly job
 * would do exactly that — as well as taking a decision that belongs to
 * Compliance. So the vendor stays ACTIVE, running trips continue, and the one
 * thing that stops is being awarded anything new.
 */
export function canBeAwardedWork(status: string, report: VendorExpiryReport): boolean {
  return status === 'ACTIVE' && !report.hasExpired;
}

/** Why not, named so an operator can act on it rather than just be refused. */
export function awardBlockReason(status: string, report: VendorExpiryReport): string | null {
  if (status !== 'ACTIVE') return null; // BR-01 already answers this case.
  if (!report.hasExpired) return null;

  const kinds = report.expired.map((e) => e.kind.replace(/_/g, ' ').toLowerCase()).join(', ');
  return `This transporter's ${kinds} has expired. Compliance has to see a current one before they can take new work.`;
}

/** One row of the sweep query: a vendor's document, flattened. */
export interface SweepRow {
  vendorId: string;
  vendorCode: string;
  vendorName: string;
  vendorStatus: string;
  vendorPhone: string | null;
  branchId: string | null;
  kind: string;
  status: string;
  validTo: string | null;
}

export interface ExpiryQueueEntry {
  vendorId: string;
  code: string;
  name: string;
  phone: string | null;
  branchId: string | null;
  status: string;
  expired: DocumentExpiry[];
  expiringSoon: DocumentExpiry[];
  /**
   * Stated on every row rather than left to be inferred from `expired.length`.
   * It is the consequence that matters, and the one thing about this queue
   * that is easy to get wrong: a lapse blocks NEW work only. Trips already
   * moving are untouched and the vendor is not suspended.
   */
  blockedFromNewWork: boolean;
  soonestDaysRemaining: number | null;
}

/**
 * The chase queue: which transporters need paperwork, worst first.
 *
 * Pure, and separate from the repository call, so the ordering can be tested
 * without a database. The order IS the feature — a queue sorted alphabetically
 * is a list, not a queue.
 */
export function buildExpiryQueue(rows: SweepRow[], asOf: Date): ExpiryQueueEntry[] {
  const byVendor = new Map<string, { vendor: SweepRow; docs: SweepRow[] }>();
  for (const row of rows) {
    const entry = byVendor.get(row.vendorId) ?? { vendor: row, docs: [] };
    entry.docs.push(row);
    byVendor.set(row.vendorId, entry);
  }

  return [...byVendor.values()]
    .map(({ vendor, docs }) => {
      const report = vendorExpiryReport(
        docs.map((d) => ({ kind: d.kind, status: d.status, validTo: d.validTo })),
        asOf,
      );
      return {
        vendorId: vendor.vendorId,
        code: vendor.vendorCode,
        name: vendor.vendorName,
        phone: vendor.vendorPhone,
        branchId: vendor.branchId,
        status: vendor.vendorStatus,
        expired: report.expired,
        expiringSoon: report.expiringSoon,
        blockedFromNewWork: report.hasExpired,
        soonestDaysRemaining: report.soonestDaysRemaining,
      };
    })
    .filter((v) => v.expired.length > 0 || v.expiringSoon.length > 0)
    .sort((a, b) => {
      // Already blocked first — those are stopping work today. Then soonest to
      // lapse, so the queue reads in the order it should be worked.
      if (a.blockedFromNewWork !== b.blockedFromNewWork) return a.blockedFromNewWork ? -1 : 1;
      return (a.soonestDaysRemaining ?? Number.MAX_SAFE_INTEGER) - (b.soonestDaysRemaining ?? Number.MAX_SAFE_INTEGER);
    });
}
