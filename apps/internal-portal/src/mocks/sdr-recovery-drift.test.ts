import { describe, expect, it } from 'vitest';
import { planRecovery as fixturePlan } from './sdr-recovery';
// The real implementation, imported straight out of internal-api — a
// dependency-free module for exactly this reason.
import { planRecovery as apiPlan } from '../../../internal-api/src/modules/sdr/sdr-recovery';

/**
 * Drift guard: the fixture's recovery planner must agree with the API's. The
 * demo runs on the fixture, so a divergence would only show on the day
 * somebody runs against the real backend.
 */

// A small deterministic generator, so a failure names a reproducible scenario.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('sdr recovery: fixture agrees with the API', () => {
  it('gives identical plans across generated scenarios', () => {
    const next = rng(42);
    for (let i = 0; i < 500; i++) {
      const count = Math.floor(next() * 5);
      const candidates = Array.from({ length: count }, (_, n) => ({
        id: `id-${n}`,
        code: `SDR-${String(Math.floor(next() * 50)).padStart(4, '0')}-${n}`,
        tripId: `trip-${Math.floor(next() * 3)}`,
        tripCode: `T${n}`,
        outstandingPaise: Math.floor(next() * 300_000),
        resolvedAt: `2026-0${1 + Math.floor(next() * 9)}-01T00:00:00Z`,
      }));
      const trip = `trip-${Math.floor(next() * 3)}`;
      const available = Math.floor(next() * 400_000) - 20_000;
      const floor = Math.floor(next() * 3) * 5_000;
      expect(fixturePlan(candidates, trip, available, floor)).toEqual(apiPlan(candidates, trip, available, floor));
    }
  });
});
