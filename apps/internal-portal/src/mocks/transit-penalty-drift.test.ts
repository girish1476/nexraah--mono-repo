import { describe, expect, it } from 'vitest';
import { computeTransitPenalty as fixture } from './transit-penalty';
// The real implementation, imported straight out of internal-api.
import { computeTransitPenalty as api } from '../../../internal-api/src/common/transit-penalty';

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('transit penalty: fixture agrees with the API', () => {
  it('gives identical results across generated scenarios', () => {
    const next = rng(7);
    for (let i = 0; i < 500; i++) {
      const start = Date.UTC(2026, 0, 1) + Math.floor(next() * 200) * 3_600_000;
      const startedAt = next() < 0.15 ? null : new Date(start).toISOString();
      const deliveredAt = new Date(start + Math.floor(next() * 15 * 24) * 3_600_000).toISOString();
      const requiredDays = next() < 0.15 ? null : Math.floor(next() * 8);
      const perDayPaise = Math.floor(next() * 3) * 25_000;
      const applies = next() < 0.7;
      const input = { startedAt, deliveredAt, requiredDays, applies, perDayPaise };
      expect(fixture(input)).toEqual(api(input));
    }
  });
});
