import { describe, it, expect } from 'vitest';
import { MIN_REASON, checkRevision, revisionRows, type LaneForRevision } from './rate-revision';
import { assertReason, DomainException } from '../../common/domain-exception';

/**
 * Client rate revision.
 *
 * The rate card had exactly one write path in the whole backend — an INSERT
 * from the RFQ award — so an agreed price could be created and never changed.
 * These pin the rules of the write path that closes that, and in particular
 * the two refusals that protect money already billed.
 */

const today = new Date('2026-08-26T09:00:00Z');

const lane: LaneForRevision = {
  id: 'lane-1',
  clientId: 'client-1',
  origin: 'Nashik',
  destination: 'Kolkata',
  truckType: '32 ft SXL',
  ratePaise: 4680000,
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
};

const input = (over: Record<string, unknown> = {}) => ({
  newRatePaise: 4900000,
  effectiveFrom: '2026-09-01',
  reason: 'Diesel surcharge agreed with the client on 25 August.',
  ...over,
});

describe('what a revision refuses', () => {
  it('accepts a well-formed revision', () => {
    expect(checkRevision(lane, input(), today).ok).toBe(true);
  });

  it('refuses backdating — it would re-price loads already raised', () => {
    /*
     * The important one. A rate starting before today silently changes what a
     * run of past loads should have cost, including delivered and invoiced
     * ones. A retrospective correction belongs in a credit note against the
     * specific invoice, where somebody can see it.
     */
    const check = checkRevision(lane, input({ effectiveFrom: '2026-07-01' }), today);
    expect(check.ok).toBe(false);
    expect(check.refusal).toBe('EFFECTIVE_IN_PAST');
    expect(check.reason).toMatch(/credit note/i);
  });

  it('accepts today as the effective date', () => {
    expect(checkRevision(lane, input({ effectiveFrom: '2026-08-26' }), today).ok).toBe(true);
  });

  it('refuses a revision that changes nothing', () => {
    expect(checkRevision(lane, input({ newRatePaise: lane.ratePaise }), today).refusal).toBe('SAME_RATE');
  });

  it('refuses a reason too short to defend later', () => {
    expect(checkRevision(lane, input({ reason: 'update' }), today).refusal).toBe('REASON_TOO_SHORT');
  });

  it('refuses revising a lane whose term has already ended', () => {
    const closed = { ...lane, validTo: '2026-06-30' };
    expect(checkRevision(closed, input(), today).refusal).toBe('LANE_ALREADY_CLOSED');
  });

  it('refuses a start date before the current rate began', () => {
    const future = { ...lane, validFrom: '2026-10-01', validTo: '2027-09-30' };
    expect(checkRevision(future, input({ effectiveFrom: '2026-09-15' }), today).refusal).toBe(
      'EFFECTIVE_BEFORE_START',
    );
  });
});

describe('the two rows a revision becomes', () => {
  const rows = revisionRows(lane, { newRatePaise: 4900000, effectiveFrom: '2026-09-01' });

  it('closes the old lane the day before the new one starts, with no overlap', () => {
    // An overlap makes "which rate was in force" ambiguous on exactly the day
    // somebody is arguing about.
    expect(rows.closeOldTo).toBe('2026-08-31');
  });

  it('carries the route and truck type across unchanged', () => {
    expect(rows.successor.origin).toBe('Nashik');
    expect(rows.successor.destination).toBe('Kolkata');
    expect(rows.successor.truckType).toBe('32 ft SXL');
    expect(rows.successor.clientId).toBe('client-1');
  });

  it('changes the price and inherits the term — a revision is not a new agreement', () => {
    expect(rows.successor.ratePaise).toBe(4900000);
    expect(rows.successor.validFrom).toBe('2026-09-01');
    expect(rows.successor.validTo).toBe('2026-12-31');
  });

  it('leaves history intact, so a past indent still cross-checks correctly', () => {
    // The whole reason this is a versioned insert rather than an UPDATE: an
    // indent picked up in July was priced against the original rate, and the
    // original row still says so.
    expect(lane.ratePaise).toBe(4680000);
    expect(rows.successor.ratePaise).not.toBe(lane.ratePaise);
  });
});

describe('the reason floor is one number, not two', () => {
  /*
   * `rate-revision.ts` cannot import `assertReason` — it is deliberately
   * dependency-free so the portal can import it, and `domain-exception.ts`
   * pulls in @nestjs/common. So the floor is written down twice. This is the
   * test that makes the second copy exercised rather than merely hopeful: a
   * revision that passed here and was then refused by the approvals engine
   * would be rejected twice, with two different messages, for the same reason.
   */
  const exactly = 'x'.repeat(MIN_REASON);
  const oneShort = 'x'.repeat(MIN_REASON - 1);

  it('accepts at the floor and refuses one character below it', () => {
    expect(checkRevision(lane, input({ reason: exactly }), today).ok).toBe(true);
    expect(checkRevision(lane, input({ reason: oneShort }), today).refusal).toBe('REASON_TOO_SHORT');
  });

  it('agrees with the approvals engine at both boundaries', () => {
    expect(() => assertReason(exactly)).not.toThrow();
    expect(() => assertReason(oneShort)).toThrow(DomainException);
  });

  it('ignores padding, on both sides', () => {
    // Otherwise twenty spaces would be a reason.
    const padded = `  ${oneShort}  `;
    expect(checkRevision(lane, input({ reason: padded }), today).refusal).toBe('REASON_TOO_SHORT');
    expect(() => assertReason(padded)).toThrow(DomainException);
  });
});
