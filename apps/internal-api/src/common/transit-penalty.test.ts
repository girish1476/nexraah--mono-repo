import { describe, expect, it } from 'vitest';
import { computeTransitPenalty } from './transit-penalty';

const at = (day: number, hour = 0) => new Date(Date.UTC(2026, 8, day, hour)).toISOString();

describe('computeTransitPenalty', () => {
  it('charges nothing when the truck arrives inside the transit days', () => {
    const p = computeTransitPenalty({ startedAt: at(1), deliveredAt: at(4), requiredDays: 3, applies: true, perDayPaise: 50_000 });
    expect(p).toEqual({ actualDays: 3, lateDays: 0, penaltyPaise: 0 });
  });

  it('charges the lane’s per-day rate for each late day', () => {
    const p = computeTransitPenalty({ startedAt: at(1), deliveredAt: at(7), requiredDays: 3, applies: true, perDayPaise: 50_000 });
    expect(p).toEqual({ actualDays: 6, lateDays: 3, penaltyPaise: 150_000 });
  });

  it('counts a part-day as a day', () => {
    const p = computeTransitPenalty({ startedAt: at(1), deliveredAt: at(4, 6), requiredDays: 3, applies: true, perDayPaise: 10_000 });
    expect(p.actualDays).toBe(4);
    expect(p.lateDays).toBe(1);
    expect(p.penaltyPaise).toBe(10_000);
  });

  it('is nil when the lane does not apply a penalty', () => {
    const p = computeTransitPenalty({ startedAt: at(1), deliveredAt: at(9), requiredDays: 3, applies: false, perDayPaise: 50_000 });
    expect(p).toEqual({ actualDays: 8, lateDays: 5, penaltyPaise: 0 });
  });

  it('is nil when the lane has no per-day amount', () => {
    const p = computeTransitPenalty({ startedAt: at(1), deliveredAt: at(9), requiredDays: 3, applies: true, perDayPaise: 0 });
    expect(p.lateDays).toBe(5);
    expect(p.penaltyPaise).toBe(0);
  });

  it('is nil when the rate carried no transit days', () => {
    const p = computeTransitPenalty({ startedAt: at(1), deliveredAt: at(9), requiredDays: null, applies: true, perDayPaise: 50_000 });
    expect(p).toEqual({ actualDays: 8, lateDays: 0, penaltyPaise: 0 });
  });

  it('charges nothing for a trip whose departure was never recorded', () => {
    const p = computeTransitPenalty({ startedAt: null, deliveredAt: at(9), requiredDays: 3, applies: true, perDayPaise: 50_000 });
    expect(p).toEqual({ actualDays: null, lateDays: 0, penaltyPaise: 0 });
  });

  it('never reports fewer than one day on the road', () => {
    const p = computeTransitPenalty({ startedAt: at(1), deliveredAt: at(1), requiredDays: 0, applies: true, perDayPaise: 10_000 });
    expect(p.actualDays).toBe(1);
  });
});
