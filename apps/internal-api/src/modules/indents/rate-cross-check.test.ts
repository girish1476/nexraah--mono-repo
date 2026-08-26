import { describe, it, expect } from 'vitest';
import { crossCheckRate, laneInEffect, type RateCardLaneLike } from './rate-cross-check';

/**
 * Rate cross-verification.
 *
 * Before this, an indent stored `rate_card_lane_id` and `sell_rate` side by
 * side and never compared them — so a contract load could be raised at any
 * price against a lane that said something else, belonged to another client,
 * or expired months ago. Every case below passed silently.
 */

const lane: RateCardLaneLike = {
  id: 'lane-1',
  clientId: 'client-1',
  origin: 'Nashik',
  destination: 'Kolkata',
  truckType: '32 ft SXL',
  ratePaise: 4680000,
  validFrom: '2026-01-01',
  validTo: '2026-12-31',
};

const indent = (over: Record<string, unknown> = {}) => ({
  clientId: 'client-1',
  fromCity: 'Nashik',
  toCity: 'Kolkata',
  truckType: '32 ft SXL',
  sellRatePaise: 4680000,
  pickupDate: '2026-09-01',
  ...over,
});

describe('the agreed price', () => {
  it('accepts an indent priced at the agreed rate', () => {
    expect(crossCheckRate(indent(), lane).ok).toBe(true);
  });

  it('refuses one priced below it — the quiet loss this exists to catch', () => {
    const check = crossCheckRate(indent({ sellRatePaise: 4000000 }), lane);
    expect(check.ok).toBe(false);
    expect(check.mismatch).toBe('RATE_MISMATCH');
    // The operator is told what the contract says, not just "wrong".
    expect(check.agreedRatePaise).toBe(4680000);
    expect(check.reason).toMatch(/spot load|revised/i);
  });

  it('refuses one priced above it too', () => {
    // Over-charging a contract client is a dispute waiting to happen, not a win.
    expect(crossCheckRate(indent({ sellRatePaise: 5200000 }), lane).mismatch).toBe('RATE_MISMATCH');
  });

  it('has no tolerance band, deliberately — one rupee out is out', () => {
    expect(crossCheckRate(indent({ sellRatePaise: 4680001 }), lane).ok).toBe(false);
  });
});

describe('whether the lane applies at all', () => {
  it('refuses another client’s lane, and says so before mentioning money', () => {
    const check = crossCheckRate(indent({ clientId: 'client-2' }), lane);
    expect(check.mismatch).toBe('WRONG_CLIENT');
  });

  it('refuses a different route', () => {
    expect(crossCheckRate(indent({ toCity: 'Chennai' }), lane).mismatch).toBe('ROUTE_MISMATCH');
  });

  it('refuses a different truck type', () => {
    expect(crossCheckRate(indent({ truckType: '20 ft' }), lane).mismatch).toBe('TRUCK_TYPE_MISMATCH');
  });

  it('is case- and whitespace-insensitive about places', () => {
    expect(crossCheckRate(indent({ fromCity: ' nashik ' }), lane).ok).toBe(true);
  });
});

describe('when the contract is in force', () => {
  it('measures against the pickup date, not today', () => {
    /*
     * The date the goods move is the date the price belongs to. A load raised
     * now for a pickup after the term ends is priced against a rate we will no
     * longer have agreed.
     */
    expect(laneInEffect(lane, '2026-06-01')).toBe(true);
    expect(laneInEffect(lane, '2027-02-01')).toBe(false);
    expect(laneInEffect(lane, '2025-12-31')).toBe(false);
  });

  it('refuses a pickup after the agreement lapses', () => {
    const check = crossCheckRate(indent({ pickupDate: '2027-03-01' }), lane);
    expect(check.mismatch).toBe('LANE_NOT_IN_EFFECT');
    expect(check.reason).toMatch(/2026-12-31/);
  });

  it('treats an open-ended lane as still running', () => {
    expect(laneInEffect({ ...lane, validTo: null }, '2030-01-01')).toBe(true);
  });
});
