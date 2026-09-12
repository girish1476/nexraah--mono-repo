import { describe, it, expect } from 'vitest';
import { rateRevisionRefusal } from './index';
// The real implementation, imported straight out of internal-api. It is a
// dependency-free module for exactly this reason — no NestJS, no repository,
// no database, so a portal test can reach it.
import { checkRevision, type LaneForRevision } from '../../../internal-api/src/modules/clients/rate-revision';

/**
 * Fixture versus API, on every combination that matters.
 *
 * Three separate bugs today came from the same shape: the fixture being
 * quietly more permissive than the API it stands in for. Nothing failed,
 * because nothing compared them — the screen looked healthy while
 * demonstrating a state the real product refuses.
 *
 * So this does not test the fixture's answers against my own expectations. It
 * tests them against `rate-revision.ts`, case for case. If the two ever
 * disagree about whether a rate change is allowed, or about *why* it is not,
 * this fails and names the case.
 */

const NOW = new Date('2026-08-26T09:00:00Z');

const RATES = [4680000, 4900000, 1, 100000000];
const DATES = [
  '2025-06-01', // before the lane started
  '2026-06-01', // in the past
  '2026-08-25', // yesterday
  '2026-08-26', // today
  '2026-08-27', // tomorrow
  '2026-12-01', // inside the term
  '2027-06-01', // after the term
  'not-a-date',
];
const REASONS = [
  '',
  'short',
  'x'.repeat(19),
  'x'.repeat(20),
  '                    ', // twenty spaces — padding is not a reason
  'Diesel surcharge agreed with the client on 25 August.',
];
const LANES: { label: string; lane: LaneForRevision }[] = [
  {
    label: 'open-ended lane',
    lane: {
      id: 'l1',
      clientId: 'c1',
      origin: 'Nashik',
      destination: 'Kolkata',
      truckType: '32 ft SXL',
      ratePaise: 4680000,
      validFrom: '2026-01-01',
      validTo: null,
    },
  },
  {
    label: 'lane still running',
    lane: {
      id: 'l2',
      clientId: 'c1',
      origin: 'Nashik',
      destination: 'Kolkata',
      truckType: '32 ft SXL',
      ratePaise: 4680000,
      validFrom: '2026-01-01',
      validTo: '2026-12-31',
    },
  },
  {
    label: 'lane whose term has ended',
    lane: {
      id: 'l3',
      clientId: 'c1',
      origin: 'Nashik',
      destination: 'Kolkata',
      truckType: '32 ft SXL',
      ratePaise: 4680000,
      validFrom: '2026-01-01',
      validTo: '2026-06-30',
    },
  },
  {
    label: 'lane starting in the future',
    lane: {
      id: 'l4',
      clientId: 'c1',
      origin: 'Nashik',
      destination: 'Kolkata',
      truckType: '32 ft SXL',
      ratePaise: 4680000,
      validFrom: '2026-10-01',
      validTo: '2027-09-30',
    },
  },
];

describe('the fixture and the API agree on every rate revision', () => {
  const cases: {
    label: string;
    lane: LaneForRevision;
    input: { newRatePaise: number; effectiveFrom: string; reason: string };
  }[] = [];

  for (const { label, lane } of LANES) {
    for (const newRatePaise of RATES) {
      for (const effectiveFrom of DATES) {
        for (const reason of REASONS) {
          cases.push({
            label: `${label} · ₹${newRatePaise / 100} · ${effectiveFrom} · reason(${reason.trim().length})`,
            lane,
            input: { newRatePaise, effectiveFrom, reason },
          });
        }
      }
    }
  }

  it(`covers every combination (${4 * 4 * 8 * 6})`, () => {
    expect(cases).toHaveLength(4 * 4 * 8 * 6);
  });

  it('agrees on whether the change is allowed at all', () => {
    const disagreements: string[] = [];
    for (const c of cases) {
      const api = checkRevision(c.lane, c.input, NOW);
      const mock = rateRevisionRefusal(
        { ratePaise: c.lane.ratePaise, validFrom: c.lane.validFrom, validTo: c.lane.validTo },
        c.input,
        NOW,
      );
      if (api.ok !== (mock === null)) {
        disagreements.push(`${c.label} — API ${api.ok ? 'allows' : 'refuses'}, fixture ${mock ? 'refuses' : 'allows'}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees on WHICH refusal applies, not merely that there is one', () => {
    /*
     * The order of the checks is the substance here. A rate change that is
     * both backdated and unexplained should report the same one of those two
     * first in both places — otherwise the fixture teaches somebody to fix the
     * wrong thing, and the screen's error copy is rehearsed against a message
     * the server never sends.
     */
    const disagreements: string[] = [];
    for (const c of cases) {
      const api = checkRevision(c.lane, c.input, NOW);
      const mock = rateRevisionRefusal(
        { ratePaise: c.lane.ratePaise, validFrom: c.lane.validFrom, validTo: c.lane.validTo },
        c.input,
        NOW,
      );
      if (api.refusal !== (mock?.code ?? null)) {
        disagreements.push(`${c.label} — API ${api.refusal}, fixture ${mock?.code ?? null}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees word for word on what it tells the person', () => {
    // The refusal text is the whole interaction for whoever hits it. Two
    // wordings for one rule is two rules as far as they can tell.
    const disagreements: string[] = [];
    for (const c of cases) {
      const api = checkRevision(c.lane, c.input, NOW);
      const mock = rateRevisionRefusal(
        { ratePaise: c.lane.ratePaise, validFrom: c.lane.validFrom, validTo: c.lane.validTo },
        c.input,
        NOW,
      );
      if ((api.reason ?? null) !== (mock?.message ?? null)) {
        disagreements.push(`${c.label}\n  API:     ${api.reason}\n  fixture: ${mock?.message}`);
      }
    }
    expect(disagreements).toEqual([]);
  });
});
