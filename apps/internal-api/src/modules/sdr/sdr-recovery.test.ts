import { describe, expect, it } from 'vitest';
import { planRecovery, type RecoveryCandidate } from './sdr-recovery';

const sdr = (over: Partial<RecoveryCandidate> & Pick<RecoveryCandidate, 'id' | 'outstandingPaise'>): RecoveryCandidate => ({
  code: `SDR-${over.id}`,
  tripId: 'trip-a',
  tripCode: 'A',
  resolvedAt: '2026-09-01T00:00:00Z',
  ...over,
});

describe('planRecovery', () => {
  it('takes nothing when there is nothing outstanding', () => {
    const plan = planRecovery([], 'trip-a', 100_000);
    expect(plan.totalPaise).toBe(0);
    expect(plan.netPaise).toBe(100_000);
    expect(plan.carriedForwardPaise).toBe(0);
  });

  it('deducts a record smaller than the balance and pays the rest', () => {
    const plan = planRecovery([sdr({ id: '1', outstandingPaise: 30_000 })], 'trip-a', 100_000);
    expect(plan.totalPaise).toBe(30_000);
    expect(plan.netPaise).toBe(70_000);
    expect(plan.carriedForwardPaise).toBe(0);
  });

  it('carries the excess forward when the deduction is bigger than the balance', () => {
    const plan = planRecovery([sdr({ id: '1', outstandingPaise: 250_000 })], 'trip-a', 100_000);
    expect(plan.totalPaise).toBe(100_000);
    expect(plan.netPaise).toBe(0);
    expect(plan.carriedForwardPaise).toBe(150_000);
    expect(plan.recoveries[0].remainingAfterPaise).toBe(150_000);
  });

  it('recovers a carried-forward record from the next trip, in small amounts', () => {
    const carried = sdr({ id: '1', tripId: 'trip-a', outstandingPaise: 150_000 });
    const first = planRecovery([carried], 'trip-b', 60_000);
    expect(first.totalPaise).toBe(60_000);
    expect(first.netPaise).toBe(0);
    expect(first.recoveries[0].ownTrip).toBe(false);
    const second = planRecovery([{ ...carried, outstandingPaise: first.carriedForwardPaise }], 'trip-c', 200_000);
    expect(second.totalPaise).toBe(90_000);
    expect(second.netPaise).toBe(110_000);
    expect(second.carriedForwardPaise).toBe(0);
  });

  it("pays down this trip's own records before older carried-forward ones", () => {
    const older = sdr({ id: 'old', tripId: 'trip-a', outstandingPaise: 50_000, resolvedAt: '2026-08-01T00:00:00Z' });
    const own = sdr({ id: 'own', tripId: 'trip-b', outstandingPaise: 50_000, resolvedAt: '2026-09-10T00:00:00Z' });
    const plan = planRecovery([older, own], 'trip-b', 60_000);
    expect(plan.recoveries.map((r) => [r.sdrId, r.amountPaise])).toEqual([
      ['own', 50_000],
      ['old', 10_000],
    ]);
    expect(plan.carriedForwardPaise).toBe(40_000);
  });

  it('takes older carried-forward records first among the rest', () => {
    const newer = sdr({ id: 'new', tripId: 'trip-a', outstandingPaise: 40_000, resolvedAt: '2026-09-05T00:00:00Z' });
    const older = sdr({ id: 'old', tripId: 'trip-z', outstandingPaise: 40_000, resolvedAt: '2026-08-05T00:00:00Z' });
    const plan = planRecovery([newer, older], 'trip-b', 50_000);
    expect(plan.recoveries.map((r) => r.sdrId)).toEqual(['old', 'new']);
  });

  it('never takes more than the payment has, and never goes negative', () => {
    const plan = planRecovery([sdr({ id: '1', outstandingPaise: 10_000 })], 'trip-a', -5_000);
    expect(plan.totalPaise).toBe(0);
    expect(plan.netPaise).toBe(0);
    expect(plan.carriedForwardPaise).toBe(10_000);
  });

  it('ignores records that are already fully recovered', () => {
    const plan = planRecovery([sdr({ id: '1', outstandingPaise: 0 })], 'trip-a', 100_000);
    expect(plan.recoveries).toHaveLength(0);
    expect(plan.netPaise).toBe(100_000);
  });

  it('always leaves a small residual payable, so a payment is never nil', () => {
    const plan = planRecovery([sdr({ id: '1', outstandingPaise: 250_000 })], 'trip-a', 100_000, 5_000);
    expect(plan.totalPaise).toBe(95_000);
    expect(plan.netPaise).toBe(5_000);
    expect(plan.carriedForwardPaise).toBe(155_000);
  });

  it('pays a balance smaller than the floor in full, deducting nothing', () => {
    const plan = planRecovery([sdr({ id: '1', outstandingPaise: 250_000 })], 'trip-a', 3_000, 5_000);
    expect(plan.totalPaise).toBe(0);
    expect(plan.netPaise).toBe(3_000);
    expect(plan.carriedForwardPaise).toBe(250_000);
  });

  it('takes a smaller deduction whole and still pays the rest', () => {
    const plan = planRecovery([sdr({ id: '1', outstandingPaise: 20_000 })], 'trip-a', 100_000, 5_000);
    expect(plan.totalPaise).toBe(20_000);
    expect(plan.netPaise).toBe(80_000);
  });
});
