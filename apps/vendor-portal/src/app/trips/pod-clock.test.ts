import { describe, it, expect } from 'vitest';
import { podClock, POD_WINDOW_DAYS, POD_FORFEIT_DAYS } from './pod-clock';

// Mirrors and extends scripts/check-pod-clock.mjs (the standalone runnable
// check `pnpm --filter vendor-portal check` uses) with the same boundary
// values, now inside the real test runner. BR-12 (20-day window), BR-24
// (₹100/day from day 21), BR-25 (nothing payable past day 40).
const PER_DAY = 10000; // ₹100/day in paise

describe('podClock — inside the window (BR-12)', () => {
  it('day 0 shows the full window remaining', () => {
    const c = podClock(0, PER_DAY);
    expect(c.headline).toBe('20 days left in the window');
    expect(c.tone).toBe('mint');
    expect(c.penaltyPaise).toBe(0);
    expect(c.forfeited).toBe(false);
  });
  it('day 19 uses the singular "day"', () => {
    expect(podClock(19, PER_DAY).headline).toBe('1 day left in the window');
  });
  it('day 20 is still free and still mint — the boundary is inclusive', () => {
    const c = podClock(POD_WINDOW_DAYS, PER_DAY);
    expect(c.penaltyPaise).toBe(0);
    expect(c.tone).toBe('mint');
    expect(c.forfeited).toBe(false);
  });
});

describe('podClock — past the window, accruing (BR-24)', () => {
  it('day 21 is exactly one day over, ₹100', () => {
    const c = podClock(21, PER_DAY);
    expect(c.penaltyPaise).toBe(10000);
    expect(c.headline).toBe('₹100 deducted so far — 1 day over');
    expect(c.tone).toBe('red');
  });
  it('day 24 is four days over, ₹400, plural wording', () => {
    const c = podClock(24, PER_DAY);
    expect(c.penaltyPaise).toBe(40000);
    expect(c.headline).toContain('₹400 deducted so far — 4 days over');
  });
  it('day 40 (last accruing day) is twenty days over, ₹2,000, not yet forfeited', () => {
    const c = podClock(POD_FORFEIT_DAYS, PER_DAY);
    expect(c.penaltyPaise).toBe(200000);
    expect(c.forfeited).toBe(false);
  });
  it('scales correctly with a different per-day rate', () => {
    const c = podClock(25, 25000); // ₹250/day, 5 days over
    expect(c.penaltyPaise).toBe(125000);
  });
});

describe('podClock — forfeited past day 40 (BR-25)', () => {
  it('day 41 is forfeited with zero penalty (nothing is payable, so nothing to deduct)', () => {
    const c = podClock(41, PER_DAY);
    expect(c.forfeited).toBe(true);
    expect(c.penaltyPaise).toBe(0);
    expect(c.tone).toBe('red');
    expect(c.headline).toBe('Forfeited — no balance is payable on this trip');
  });
  it('stays forfeited arbitrarily far past day 40', () => {
    expect(podClock(120, PER_DAY).forfeited).toBe(true);
  });
});
