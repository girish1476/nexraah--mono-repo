import { describe, it, expect, beforeEach } from 'vitest';
import { orderLadder, advanceDocsUploaded } from './index';
import { db } from './db';
// The real implementation, imported straight out of internal-api. It is a
// dependency-free module for exactly this reason — no NestJS, no repository,
// no database, so a portal test can reach it.
import {
  ladder as apiLadder,
  advanceDocsIn as apiAdvanceDocsIn,
  POD_STATUSES,
  type LadderFacts,
} from '../../../internal-api/src/modules/orders/order-ladder';

/**
 * Drift guard: the fixture's ladder must agree with the API's, always.
 *
 * There are two implementations of the ten steps in this repo — the API's,
 * and the mirror the fixture adapter serves the demo from. Two copies of a
 * decision drift, and this particular drift is invisible: the demo runs on
 * mocks, so a divergence only shows up the day somebody runs with
 * `NEXT_PUBLIC_USE_MOCKS=0`, by which point the two have been quietly
 * disagreeing for weeks.
 *
 * The right fix is one copy — `packages/*` is already in the workspace glob
 * and empty, so a shared package is the intended home for it. That is a
 * build-config change across two apps, which was not worth making while a
 * live demo was being served off this tree. Until then, this suite runs the
 * same scenarios through both and fails the day they disagree, which is the
 * next best thing.
 *
 * If you are here because this file went red: the fixture and the API have
 * diverged. Fix the implementations, not the test.
 */

const DOCS = ['LOADING_SLIP', 'EWAY_BILL'];

/** Every combination worth distinguishing, named so a failure reads clearly. */
const SCENARIOS: {
  name: string;
  indentStage: string;
  failureCause: string | null;
  trip: LadderFacts['trip'];
  docs: { kind: string; status: string }[];
}[] = [];

const TRIP_STAGES = ['OPEN', 'IN_TRANSIT', 'DELIVERED', 'CLOSED'];
// Enumerated from the API's own constant: a status added there widens this
// cross-product on its own, rather than leaving a blind spot until somebody
// remembers to update a copy here.
const DOC_SETS: { label: string; docs: { kind: string; status: string }[] }[] = [
  { label: 'no papers', docs: [] },
  { label: 'one paper only', docs: [{ kind: DOCS[0], status: 'PENDING' }] },
  { label: 'all pending', docs: DOCS.map((kind) => ({ kind, status: 'PENDING' })) },
  { label: 'all verified', docs: DOCS.map((kind) => ({ kind, status: 'VERIFIED' })) },
  {
    label: 'one rejected',
    docs: [
      { kind: DOCS[0], status: 'VERIFIED' },
      { kind: DOCS[1], status: 'REJECTED' },
    ],
  },
];

SCENARIOS.push({ name: 'placement failed', indentStage: 'OPEN', failureCause: 'NO_QUOTE_AT_ALL', trip: null, docs: [] });
SCENARIOS.push({ name: 'open, no trip', indentStage: 'OPEN', failureCause: null, trip: null, docs: [] });
SCENARIOS.push({ name: 'placed, trip missing', indentStage: 'TRIP_CREATED', failureCause: null, trip: null, docs: [] });

for (const lrCode of [null, 'LR-1']) {
  for (const stage of TRIP_STAGES) {
    for (const podStatus of POD_STATUSES) {
      for (const advancePaidPaise of [0, 5000]) {
        for (const balancePaidPaise of [0, 9000]) {
          for (const set of DOC_SETS) {
            SCENARIOS.push({
              name: `lr=${lrCode ?? 'none'} stage=${stage} pod=${podStatus} adv=${advancePaidPaise} bal=${balancePaidPaise} docs=${set.label}`,
              indentStage: 'TRIP_CREATED',
              failureCause: null,
              trip: { stage, podStatus, advancePaidPaise, balancePaidPaise, lrCode },
              docs: set.docs,
            });
          }
        }
      }
    }
  }
}

beforeEach(() => {
  db.config.advance_document_set = [...DOCS];
});

describe('the fixture ladder and the API ladder agree', () => {
  it(`covers ${SCENARIOS.length} scenarios`, () => {
    // Guards the matrix itself: a refactor that accidentally empties it would
    // otherwise leave every assertion below trivially passing.
    expect(SCENARIOS.length).toBeGreaterThan(500);
  });

  for (const s of SCENARIOS) {
    it(`agrees: ${s.name}`, () => {
      const byKind = new Map(s.docs.map((d) => [d.kind, d.status]));
      const docsIn = apiAdvanceDocsIn(DOCS, byKind);

      const fromApi = apiLadder({
        indentStage: s.indentStage,
        failureCause: s.failureCause,
        trip: s.trip,
        advanceDocsUploaded: docsIn,
      });

      const fromFixture = orderLadder(
        { stage: s.indentStage, failureCause: s.failureCause },
        s.trip ? { ...s.trip, documents: s.docs } : null,
      );

      expect(fromFixture).toBe(fromApi);
    });
  }
});

describe('the two advance-document rules agree', () => {
  for (const set of DOC_SETS) {
    it(`agrees: ${set.label}`, () => {
      const byKind = new Map(set.docs.map((d) => [d.kind, d.status]));
      expect(advanceDocsUploaded({ documents: set.docs })).toBe(apiAdvanceDocsIn(DOCS, byKind));
    });
  }
});
