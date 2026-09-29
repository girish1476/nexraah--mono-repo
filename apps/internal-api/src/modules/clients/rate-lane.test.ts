import { describe, expect, it } from 'vitest';
import { checkNewLane, periodsOverlap, type NewLaneInput } from './rate-lane';

const base: NewLaneInput = {
  origin: 'Visakhapatnam',
  destination: 'Hyderabad',
  truckType: '32 ft MXL',
  ratePaise: 4500000,
  transitDays: 3,
  validFrom: '2026-10-01',
  validTo: null,
  reason: 'Agreed on the 24 Sept call with their logistics head',
};

describe('checkNewLane', () => {
  it('accepts a lane with no clash', () => {
    expect(checkNewLane(base, []).ok).toBe(true);
  });

  it('refuses the same pickup and drop city, ignoring case and spacing', () => {
    const r = checkNewLane({ ...base, destination: ' visakhapatnam ' }, []);
    expect(r.refusal).toBe('SAME_CITY');
  });

  it('refuses an end date before the start', () => {
    expect(checkNewLane({ ...base, validTo: '2026-09-01' }, []).refusal).toBe('BAD_DATES');
  });

  it('refuses a source shorter than 20 characters', () => {
    expect(checkNewLane({ ...base, reason: 'per call' }, []).refusal).toBe('REASON_TOO_SHORT');
  });

  it('refuses a lane whose dates overlap an open-ended one', () => {
    const r = checkNewLane(base, [{ id: 'a', validFrom: '2026-01-01', validTo: null }]);
    expect(r.refusal).toBe('LANE_EXISTS');
  });

  it('allows a lane that starts the day after another one ends', () => {
    const r = checkNewLane(base, [{ id: 'a', validFrom: '2026-01-01', validTo: '2026-09-30' }]);
    expect(r.ok).toBe(true);
  });
});

describe('periodsOverlap', () => {
  it('treats a shared end day as an overlap', () => {
    expect(periodsOverlap({ from: '2026-01-01', to: '2026-03-01' }, { from: '2026-03-01', to: null })).toBe(true);
  });
});
