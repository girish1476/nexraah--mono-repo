import { describe, it, expect } from 'vitest';
import {
  EXPIRY_WARNING_DAYS,
  awardBlockReason,
  buildExpiryQueue,
  canBeAwardedWork,
  daysUntil,
  expiryStateOf,
  vendorExpiryReport,
  type SweepRow,
} from './vendor-document-expiry';

/**
 * The periodic vendor audit the app never had.
 *
 * `vendor_documents.valid_to` was captured, displayed, and read by nothing —
 * so a transporter whose trade licence lapsed a year ago stayed ACTIVE, passed
 * BR-01 at award, and kept being given loads. These pin the rule that closes
 * it, including the two judgement calls it rests on: absent expiry is not
 * expiry, and a lapse blocks new work without suspending the vendor.
 */

const asOf = new Date('2026-08-26T10:00:00Z');
const doc = (over: Partial<{ kind: string; status: string; validTo: string | null }> = {}) => ({
  kind: 'TRADE_LICENCE',
  status: 'VERIFIED',
  validTo: '2027-01-01',
  ...over,
});

describe('reading an expiry date', () => {
  it('counts a document valid through today as still valid', () => {
    // Valid *to* the 26th means valid for the whole of the 26th.
    expect(daysUntil('2026-08-26', asOf)).toBe(0);
    expect(expiryStateOf(doc({ validTo: '2026-08-26' }), asOf).state).toBe('EXPIRING_SOON');
  });

  it('treats yesterday as expired', () => {
    expect(expiryStateOf(doc({ validTo: '2026-08-25' }), asOf).state).toBe('EXPIRED');
  });

  it('warns inside the chase window and stays quiet outside it', () => {
    const inside = new Date(asOf.getTime() + (EXPIRY_WARNING_DAYS - 1) * 86_400_000);
    const outside = new Date(asOf.getTime() + (EXPIRY_WARNING_DAYS + 5) * 86_400_000);
    expect(expiryStateOf(doc({ validTo: inside.toISOString().slice(0, 10) }), asOf).state).toBe('EXPIRING_SOON');
    expect(expiryStateOf(doc({ validTo: outside.toISOString().slice(0, 10) }), asOf).state).toBe('VALID');
  });

  it('does NOT treat a missing expiry date as expired', () => {
    /*
     * The judgement call. A rule that fires on absent data punishes bad
     * record-keeping rather than lapsed paperwork — and would have suspended
     * every vendor onboarded before the field was filled in reliably.
     */
    expect(expiryStateOf(doc({ validTo: null }), asOf).state).toBe('NO_EXPIRY');
    expect(vendorExpiryReport([doc({ validTo: null })], asOf).hasExpired).toBe(false);
  });
});

describe('which documents expire at all', () => {
  it('watches the legal documents', () => {
    for (const kind of ['TRADE_LICENCE', 'LABOUR_LICENCE', 'RC', 'UDYAM']) {
      const report = vendorExpiryReport([doc({ kind, validTo: '2020-01-01' })], asOf);
      expect(report.hasExpired, `${kind} should be watched`).toBe(true);
    }
  });

  it('ignores point-in-time records', () => {
    // A TDS declaration and a bank statement are held on file (BR-03/BR-33).
    // They do not lapse in a way that should stop a truck.
    for (const kind of ['TDS_DECLARATION', 'BANK_STATEMENT']) {
      const report = vendorExpiryReport([doc({ kind, validTo: '2020-01-01' })], asOf);
      expect(report.hasExpired, `${kind} should be ignored`).toBe(false);
    }
  });

  it('ignores an unverified document — BR-01 already catches those', () => {
    const report = vendorExpiryReport([doc({ status: 'PENDING', validTo: '2020-01-01' })], asOf);
    expect(report.hasExpired).toBe(false);
  });
});

describe('what a lapse actually does', () => {
  const expired = vendorExpiryReport([doc({ validTo: '2020-01-01' })], asOf);
  const current = vendorExpiryReport([doc()], asOf);

  it('blocks new work for an ACTIVE vendor with a lapsed document', () => {
    // The bug in one line: ACTIVE is a statement about the past.
    expect(canBeAwardedWork('ACTIVE', expired)).toBe(false);
    expect(canBeAwardedWork('ACTIVE', current)).toBe(true);
  });

  it('says which document and what to do about it', () => {
    const reason = awardBlockReason('ACTIVE', expired);
    expect(reason).toMatch(/trade licence/i);
    expect(reason).toMatch(/Compliance/);
  });

  it('leaves the BR-01 status case to BR-01', () => {
    // Two systems reporting the same refusal differently is how a person ends
    // up fixing the wrong thing.
    expect(awardBlockReason('SUSPENDED', current)).toBeNull();
  });

  it('sorts a chase queue by the soonest expiry still ahead', () => {
    const report = vendorExpiryReport(
      [doc({ kind: 'RC', validTo: '2026-09-10' }), doc({ kind: 'UDYAM', validTo: '2026-12-01' })],
      asOf,
    );
    expect(report.soonestDaysRemaining).toBe(15);
  });
});

describe('the chase queue', () => {
  /*
   * The order IS the feature. A queue sorted alphabetically is a list — it
   * does not tell Compliance what to do first, which is the only reason to
   * build a queue rather than a report.
   */
  const row = (over: Partial<SweepRow>): SweepRow => ({
    vendorId: 'v1',
    vendorCode: 'VEN-1',
    vendorName: 'Rathod Roadlines',
    vendorStatus: 'ACTIVE',
    vendorPhone: '9876543210',
    branchId: 'br-1',
    kind: 'TRADE_LICENCE',
    status: 'VERIFIED',
    validTo: '2027-01-01',
    ...over,
  });

  it('puts transporters already blocked ahead of ones merely expiring', () => {
    const queue = buildExpiryQueue(
      [
        row({ vendorId: 'soon', vendorName: 'Expiring next week', validTo: '2026-09-02' }),
        row({ vendorId: 'blocked', vendorName: 'Already lapsed', validTo: '2025-01-01' }),
      ],
      asOf,
    );
    expect(queue.map((v) => v.vendorId)).toEqual(['blocked', 'soon']);
    expect(queue[0].blockedFromNewWork).toBe(true);
    expect(queue[1].blockedFromNewWork).toBe(false);
  });

  it('orders the rest by soonest to lapse', () => {
    const queue = buildExpiryQueue(
      [
        row({ vendorId: 'later', validTo: '2026-09-20' }),
        row({ vendorId: 'sooner', validTo: '2026-09-01' }),
      ],
      asOf,
    );
    expect(queue.map((v) => v.vendorId)).toEqual(['sooner', 'later']);
  });

  it('groups one transporter’s documents onto a single row', () => {
    // Two lapsed papers is one phone call, not two queue entries.
    const queue = buildExpiryQueue(
      [
        row({ kind: 'TRADE_LICENCE', validTo: '2025-01-01' }),
        row({ kind: 'LABOUR_LICENCE', validTo: '2025-02-01' }),
      ],
      asOf,
    );
    expect(queue).toHaveLength(1);
    expect(queue[0].expired.map((e) => e.kind).sort()).toEqual(['LABOUR_LICENCE', 'TRADE_LICENCE']);
  });

  it('leaves out transporters whose papers are all current', () => {
    // A queue that lists everybody is a directory. Only what needs doing.
    expect(buildExpiryQueue([row({ validTo: '2030-01-01' })], asOf)).toEqual([]);
  });

  it('carries the phone number, because the next step is ringing them', () => {
    const queue = buildExpiryQueue([row({ validTo: '2025-01-01' })], asOf);
    expect(queue[0].phone).toBe('9876543210');
    expect(queue[0].code).toBe('VEN-1');
  });
});
