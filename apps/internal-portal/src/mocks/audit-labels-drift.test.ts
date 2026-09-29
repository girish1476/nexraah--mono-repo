import { describe, it, expect } from 'vitest';
import { auditActionLabel, auditChangedFields, auditDescribe, auditEntityLabel } from './index';
import {
  actionLabel,
  changedFields,
  describe as apiDescribe,
  entityLabel,
} from '../../../internal-api/src/modules/audit/audit-labels';

/**
 * The audit trail reads the same in both places, or it reads wrong in one.
 *
 * The whole value of this screen is that what it says can be relied on. A
 * fixture that words an entry differently from the API is not a cosmetic
 * mismatch here — somebody rehearses a review against one set of sentences and
 * gets another in production, on the screen whose entire job is settling
 * arguments about what happened.
 */

const ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'STATUS_CHANGE',
  'APPROVAL_RAISED',
  'APPROVAL_APPROVED',
  'APPROVAL_REJECTED',
  'PAYMENT_RELEASED',
  'DOCUMENT_VERIFIED',
  'DOCUMENT_REJECTED',
  'RATE_REVISION_APPLIED',
  'VENDOR_ACTIVATED',
  'CLIENT_ACTIVATED',
  // Not in either map — the fallback has to agree too, or a future wave's
  // action reads one way in the demo and another in the product.
  'SOME_FUTURE_ACTION',
  'ANOTHER_ONE_ENTIRELY',
];

const ENTITY_TYPES = [
  'vendors',
  'vendor_documents',
  'clients',
  'client_documents',
  'indents',
  'trips',
  'trip_documents',
  'rate_card_lanes',
  'payments',
  'invoices',
  'receipts',
  'approvals',
  'pod_receipts',
  'quotes',
  'rfqs',
  'users',
  'roles',
  'config',
  'notifications',
  'some_future_table',
];

describe('the fixture and the API word an entry identically', () => {
  it('agrees on every action verb, including unknown ones', () => {
    for (const action of ACTIONS) {
      expect(auditActionLabel(action), action).toBe(actionLabel(action));
    }
  });

  it('agrees on every entity noun, including unknown ones', () => {
    for (const entityType of ENTITY_TYPES) {
      expect(auditEntityLabel(entityType), entityType).toBe(entityLabel(entityType));
    }
  });

  it('composes the same sentence for every combination', () => {
    for (const action of ACTIONS) {
      for (const entityType of ENTITY_TYPES) {
        const row = { actorName: 'Priya Nair', actorRole: 'FINANCE', action, entityType, entityId: 'x' };
        expect(auditDescribe(row), `${action} · ${entityType}`).toBe(apiDescribe(row));
      }
    }
  });

  it('falls back the same way when the person is gone', () => {
    const row = { actorName: null, actorRole: 'OPS', action: 'CREATE', entityType: 'indents', entityId: 'i' };
    expect(auditDescribe(row)).toBe(apiDescribe(row));
  });
});

describe('the fixture and the API diff a change identically', () => {
  const CASES: [unknown, unknown][] = [
    [{ status: 'PENDING' }, { status: 'VERIFIED' }],
    [{ a: 1, b: 2, c: 3 }, { b: 99 }],
    [null, { name: 'Apex Ceramics', status: 'DRAFT' }],
    [{ a: 1 }, null],
    [{ meta: { a: 1 } }, { meta: { a: 1 } }],
    [{ meta: { a: 1 } }, { meta: { a: 2 } }],
    [undefined, undefined],
    [{ x: null }, { x: 0 }],
    [{ list: [1, 2] }, { list: [1, 2, 3] }],
    ['not an object', { a: 1 }],
  ];

  it('reports the same fields as changed in every case', () => {
    for (const [before, after] of CASES) {
      expect(auditChangedFields(before, after), JSON.stringify({ before, after })).toEqual(
        changedFields(before, after),
      );
    }
  });
});
