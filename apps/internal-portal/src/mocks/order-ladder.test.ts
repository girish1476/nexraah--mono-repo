import { describe, it, expect, beforeEach } from 'vitest';
import { orderLadder, advanceDocsUploaded } from './index';
import { db } from './db';
import { POD_STATUSES } from '../../../internal-api/src/modules/orders/order-ladder';

/**
 * The ten-step ladder — the first tests it has ever had.
 *
 * Worth stating why they live here rather than next to the real
 * implementation: `OrdersService.ladder()` in internal-api is the authority,
 * but that app has no test runner and there is no database on this machine, so
 * nothing there can be exercised. The fixture adapter's `orderLadder()` is a
 * deliberate mirror of it — same order of tests, same decisions — and it is
 * what the running demo actually serves. Testing the mirror is not as good as
 * testing the original, but it is the difference between the spine having zero
 * coverage and having some, and it pins the behaviour both copies must share.
 *
 * If the two ever diverge, that is the bug — not these tests.
 */

const DOCS = ['LOADING_SLIP', 'EWAY_BILL'];

const indent = (over: Record<string, unknown> = {}) => ({
  id: 'i-1',
  stage: 'TRIP_CREATED',
  failureCause: null,
  ...over,
});

const trip = (over: Record<string, unknown> = {}) => ({
  id: 't-1',
  lrCode: 'LR-1',
  stage: 'OPEN',
  podStatus: 'PENDING',
  advancePaidPaise: 0,
  balancePaidPaise: 0,
  documents: DOCS.map((kind) => ({ kind, status: 'PENDING' })),
  ...over,
});

beforeEach(() => {
  db.config.advance_document_set = [...DOCS];
});

describe('the ten steps, in order', () => {
  it('an indent nobody could place is FAILED, not step zero', () => {
    expect(orderLadder(indent({ stage: 'OPEN', failureCause: 'NO_QUOTE_AT_ALL' }), null)).toBe('FAILED');
  });

  it('an open indent with no trip is step 1', () => {
    expect(orderLadder(indent({ stage: 'OPEN' }), null)).toBe('INDENT_CREATED');
  });

  it('a placed indent whose trip has no LR and no papers is step 2', () => {
    expect(orderLadder(indent(), trip({ lrCode: null, documents: [] }))).toBe('TRIP_GENERATED');
  });

  it('an LR with no papers in is step 3', () => {
    expect(orderLadder(indent(), trip({ documents: [] }))).toBe('LR_ISSUED');
  });

  it('papers in but unpaid is step 4', () => {
    expect(orderLadder(indent(), trip())).toBe('ADVANCE_DOCS_UPLOADED');
  });

  it('advance paid while the truck has not left is step 5', () => {
    expect(orderLadder(indent(), trip({ advancePaidPaise: 100 }))).toBe('ADVANCE_PAID');
  });

  it('in transit is step 6', () => {
    expect(orderLadder(indent(), trip({ advancePaidPaise: 100, stage: 'IN_TRANSIT' }))).toBe('TRACKING');
  });

  it('delivered with no proof yet is step 7', () => {
    expect(orderLadder(indent(), trip({ advancePaidPaise: 100, stage: 'DELIVERED' }))).toBe('UNLOADED');
  });

  it.each(['ATTACHED', 'RECEIVED'])('proof %s is step 8', (podStatus) => {
    expect(orderLadder(indent(), trip({ advancePaidPaise: 100, stage: 'DELIVERED', podStatus }))).toBe(
      'POD_UPLOADED',
    );
  });

  it('proof approved but balance unpaid is step 9 — approval alone does not settle it', () => {
    expect(orderLadder(indent(), trip({ advancePaidPaise: 100, stage: 'DELIVERED', podStatus: 'APPROVED' }))).toBe(
      'POD_VERIFIED',
    );
  });

  it('balance paid is step 10', () => {
    expect(
      orderLadder(
        indent(),
        trip({ advancePaidPaise: 100, stage: 'CLOSED', podStatus: 'APPROVED', balancePaidPaise: 500 }),
      ),
    ).toBe('BALANCE_RELEASED');
  });
});

describe('the two exits that are not steps', () => {
  /*
   * The regression 6c found, and the one the drift guard could never have
   * caught: both implementations were wrong the same way, so they agreed.
   *
   * `pod_status` has seven legal values. The ladder's closing line used to
   * catch every one it had not already answered — VERIFIED, APPROVED, and
   * also REJECTED and FORFEITED. So a forfeited order, where the proof never
   * arrived and the transporter's balance is gone, was stored as
   * POD_VERIFIED at step 9 of 10: one rung short of settled, and impossible
   * to tell apart from a proof somebody had actually checked. Every
   * count-by-step report would have quietly included them.
   *
   * It is written for real — `jobs.service.ts` (the nightly sweep) and
   * `payments.service.ts` both set it.
   */
  it('a forfeited proof is its own terminal status, not "proof checked"', () => {
    const forfeited = trip({ advancePaidPaise: 100, stage: 'CLOSED', podStatus: 'FORFEITED' });
    expect(orderLadder(indent(), forfeited)).toBe('POD_FORFEITED');
    expect(orderLadder(indent(), forfeited)).not.toBe('POD_VERIFIED');
  });

  it('a forfeited order stays forfeited even though no balance was paid', () => {
    // The balance is exactly what was lost, so `balancePaidPaise === 0` must
    // not read as "checked, awaiting payment".
    expect(
      orderLadder(indent(), trip({ advancePaidPaise: 100, stage: 'CLOSED', podStatus: 'FORFEITED', balancePaidPaise: 0 })),
    ).toBe('POD_FORFEITED');
  });

  it('a rejected proof goes back to waiting, not forward to "proof in"', () => {
    // Latent — internal-api's reject() writes ATTACHED or PENDING — but the
    // schema permits REJECTED, and letting it fall through the closing line
    // is precisely how FORFEITED went wrong.
    expect(orderLadder(indent(), trip({ advancePaidPaise: 100, stage: 'DELIVERED', podStatus: 'REJECTED' }))).toBe(
      'UNLOADED',
    );
  });

  it('every legal pod_status gets a deliberate answer', () => {
    // The guard against the actual mistake: a value nobody thought about
    // falling into whatever the last line happens to return.
    // From the API's exported constant, not a copy — so adding a status
    // there makes this test cover it rather than quietly ignore it.
    const answers = POD_STATUSES.map((podStatus) =>
      orderLadder(indent(), trip({ advancePaidPaise: 100, stage: 'DELIVERED', podStatus })),
    );
    expect(POD_STATUSES).toHaveLength(7);
    expect(answers).toEqual([
      'UNLOADED',
      'POD_UPLOADED',
      'POD_UPLOADED',
      'POD_VERIFIED',
      'POD_VERIFIED',
      'UNLOADED',
      'POD_FORFEITED',
    ]);
  });
});

describe('advance papers', () => {
  it('counts a PENDING paper as in — step 4 is "papers in", not "papers checked"', () => {
    expect(advanceDocsUploaded(trip())).toBe(true);
  });

  it('does not count a missing paper', () => {
    expect(advanceDocsUploaded(trip({ documents: [{ kind: 'LOADING_SLIP', status: 'PENDING' }] }))).toBe(false);
  });

  /*
   * The regression this file was written for.
   *
   * A REJECTED paper used to count as "in", because the check was
   * `status !== 'MISSING'` and REJECTED is not MISSING. Two things were wrong
   * with that: the advance gate already treats REJECTED as unmet, so the two
   * disagreed about the same fact; and it made rejecting a document a silent
   * no-op on the ladder — the backend wiring calls recompute on rejection, and
   * nothing would have moved.
   */
  it('does NOT count a REJECTED paper — somebody has to send it again', () => {
    const rejected = trip({
      documents: [
        { kind: 'LOADING_SLIP', status: 'VERIFIED' },
        { kind: 'EWAY_BILL', status: 'REJECTED' },
      ],
    });
    expect(advanceDocsUploaded(rejected)).toBe(false);
    expect(orderLadder(indent(), rejected)).toBe('LR_ISSUED');
  });

  it('rejecting a paper walks the ladder back from step 4 to step 3', () => {
    const before = trip();
    expect(orderLadder(indent(), before)).toBe('ADVANCE_DOCS_UPLOADED');

    const after = trip({
      documents: [
        { kind: 'LOADING_SLIP', status: 'PENDING' },
        { kind: 'EWAY_BILL', status: 'REJECTED' },
      ],
    });
    expect(orderLadder(indent(), after)).toBe('LR_ISSUED');
  });

  it('an empty configured set means nothing gates the advance', () => {
    db.config.advance_document_set = [];
    expect(advanceDocsUploaded(trip({ documents: [] }))).toBe(true);
  });
});

describe('the lorry receipt is optional (FLOWS.md §6, "if needed")', () => {
  it('an order with no LR is not stuck at step 2 once its papers are in', () => {
    expect(orderLadder(indent(), trip({ lrCode: null }))).toBe('ADVANCE_DOCS_UPLOADED');
  });

  it('an order with no LR that is already paid keeps climbing', () => {
    expect(orderLadder(indent(), trip({ lrCode: null, advancePaidPaise: 100 }))).toBe('ADVANCE_PAID');
  });
});
