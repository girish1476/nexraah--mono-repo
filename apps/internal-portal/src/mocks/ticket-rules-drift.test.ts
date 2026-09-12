import { describe, it, expect } from 'vitest';
import { ticketTransitionRefusal } from './index';
// The real rules, imported straight out of internal-api — a dependency-free
// module for exactly this reason.
import {
  TICKET_STATUSES,
  checkTransition,
  type TicketStatus,
} from '../../../internal-api/src/modules/tickets/ticket-rules';

/**
 * Fixture versus API, on every ticket transition there is.
 *
 * The fixture being quietly more permissive than the API is the failure mode
 * this codebase keeps hitting — a screen demonstrating a state the product
 * refuses. Here it would be worse than cosmetic: the rule that matters is
 * "you cannot close a ticket without saying what was done", and a demo that
 * lets you close one silently teaches exactly the habit the rule exists to
 * prevent.
 */

const RESOLUTIONS = [
  undefined,
  null,
  '',
  '   ',
  'fixed',
  'x'.repeat(19),
  'x'.repeat(20),
  'Corrected the client name on CLT-0092 and re-issued the invoice.',
];

const TARGETS: string[] = [...TICKET_STATUSES, 'CLOSED', 'DONE'];

describe('the fixture and the API agree on every ticket transition', () => {
  const cases: { from: TicketStatus; to: string; resolution: string | null | undefined }[] = [];
  for (const from of TICKET_STATUSES) {
    for (const to of TARGETS) {
      for (const resolution of RESOLUTIONS) {
        cases.push({ from, to, resolution });
      }
    }
  }

  it(`covers every combination (${4 * 6 * 8})`, () => {
    expect(cases).toHaveLength(4 * 6 * 8);
  });

  it('agrees on whether the move is allowed at all', () => {
    const disagreements: string[] = [];
    for (const c of cases) {
      // The fixture treats "no change" as a no-op rather than a transition,
      // which the API expresses by never calling checkTransition in that case.
      if (c.to === c.from) continue;
      const api = checkTransition(c.from, c.to, c.resolution);
      const mock = ticketTransitionRefusal(c.from, c.to, c.resolution);
      if (api.ok !== (mock === null)) {
        disagreements.push(
          `${c.from} → ${c.to} (note ${JSON.stringify(c.resolution)}) — API ${api.ok ? 'allows' : 'refuses'}, fixture ${mock ? 'refuses' : 'allows'}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees on WHICH refusal fires, not merely that one does', () => {
    /*
     * The order of the checks is the substance. A close that is both to an
     * already-closed ticket and missing its note should report the same one
     * first in both places, or the fixture teaches somebody to fix the wrong
     * thing.
     */
    const disagreements: string[] = [];
    for (const c of cases) {
      if (c.to === c.from) continue;
      const api = checkTransition(c.from, c.to, c.resolution);
      const mock = ticketTransitionRefusal(c.from, c.to, c.resolution);
      if (api.refusal !== (mock?.code ?? null)) {
        disagreements.push(`${c.from} → ${c.to} — API ${api.refusal}, fixture ${mock?.code ?? null}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees word for word on what it tells the person', () => {
    const disagreements: string[] = [];
    for (const c of cases) {
      if (c.to === c.from) continue;
      const api = checkTransition(c.from, c.to, c.resolution);
      const mock = ticketTransitionRefusal(c.from, c.to, c.resolution);
      if ((api.reason ?? null) !== (mock?.message ?? null)) {
        disagreements.push(
          `${c.from} → ${c.to}\n  API:     ${api.reason}\n  fixture: ${mock?.message}`,
        );
      }
    }
    expect(disagreements).toEqual([]);
  });
});
