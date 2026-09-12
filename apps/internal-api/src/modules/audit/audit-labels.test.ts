import { describe, it, expect } from 'vitest';
import { actionLabel, changedFields, describe as describeRow, entityLabel } from './audit-labels';

/**
 * The audit trail, made readable.
 *
 * `audit_events` has been written on every mutation since day one and read by
 * nothing — no controller, no route, no query. So "transactions check" and
 * "legitimacy of operations", both named as Finance's job in the owner's own
 * notes, could not be done in the app at all.
 *
 * These cover the part that decides whether the new screen is usable: turning
 * `STATUS_CHANGE` on `trip_documents` into a sentence, and showing what
 * actually moved instead of two blobs of JSON to compare by eye.
 */

describe('saying what happened in words', () => {
  it('names the common actions plainly', () => {
    expect(actionLabel('PAYMENT_RELEASED')).toBe('released payment for');
    expect(actionLabel('APPROVAL_REJECTED')).toBe('turned down');
    expect(actionLabel('RATE_REVISION_APPLIED')).toBe('changed the agreed rate on');
  });

  it('degrades an unknown action to something readable, never to a blank', () => {
    /*
     * The one that matters for a log that outlives the code that writes it.
     * A new action added by a later wave must not render as an empty cell or
     * as a raw enum — it should read as roughly the right thing until somebody
     * gives it a proper verb.
     */
    expect(actionLabel('SOMETHING_NEW_ENTIRELY')).toBe('something new entirely');
    expect(actionLabel('SOMETHING_NEW_ENTIRELY')).not.toBe('');
  });

  it('uses the console’s own words for things, not the table names', () => {
    expect(entityLabel('vendors')).toBe('transporter');
    expect(entityLabel('indents')).toBe('load request');
    expect(entityLabel('pod_receipts')).toBe('delivery proof');
    expect(entityLabel('rate_card_lanes')).toBe('agreed rate');
  });

  it('writes a whole sentence', () => {
    expect(
      describeRow({
        actorName: 'Priya Nair',
        actorRole: 'FINANCE',
        action: 'PAYMENT_RELEASED',
        entityType: 'payments',
        entityId: 'p-1',
      }),
    ).toBe('Priya Nair released payment for a payment');
  });

  it('still names somebody when the user record is gone', () => {
    // `actor_id` is nullable and a person can leave. "Somebody with the OPS
    // role" is a worse answer than a name and a much better one than blank.
    expect(
      describeRow({
        actorName: null,
        actorRole: 'OPS',
        action: 'CREATE',
        entityType: 'indents',
        entityId: 'i-1',
      }),
    ).toBe('Somebody with the OPS role created a load request');
  });
});

describe('showing what actually changed', () => {
  it('lists only the fields that moved', () => {
    const changed = changedFields(
      { status: 'PENDING', rate: 100, city: 'Nashik' },
      { status: 'VERIFIED', rate: 100, city: 'Nashik' },
    );
    expect(changed).toEqual([{ field: 'status', from: 'PENDING', to: 'VERIFIED' }]);
  });

  it('ignores fields a partial update never touched', () => {
    /*
     * The trap. Most writes record only what they changed, so `after` carries
     * three keys where `before` carried thirty. Diffing over the union would
     * report twenty-seven phantom removals on every row and make the screen
     * useless exactly where it matters most.
     */
    const changed = changedFields({ a: 1, b: 2, c: 3 }, { b: 99 });
    expect(changed).toEqual([{ field: 'b', from: 2, to: 99 }]);
  });

  it('treats a creation as every field being set', () => {
    expect(changedFields(null, { name: 'Apex Ceramics', status: 'DRAFT' })).toEqual([
      { field: 'name', from: null, to: 'Apex Ceramics' },
      { field: 'status', from: null, to: 'DRAFT' },
    ]);
  });

  it('compares nested values properly rather than by identity', () => {
    // Two structurally identical objects are not a change. Reference equality
    // would report one on every row that carries a nested payload.
    expect(changedFields({ meta: { a: 1 } }, { meta: { a: 1 } })).toEqual([]);
    expect(changedFields({ meta: { a: 1 } }, { meta: { a: 2 } })).toHaveLength(1);
  });

  it('returns nothing rather than throwing on a deletion', () => {
    // `after` is null for a delete. The screen asks for a diff regardless.
    expect(changedFields({ a: 1 }, null)).toEqual([]);
  });
});
