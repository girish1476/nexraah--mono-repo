import { describe, it, expect, beforeEach } from 'vitest';
import { requiredDocumentKinds, onboardingGate, canRaiseIndent, indentBlockReason } from '../../../internal-api/src/modules/clients/client-onboarding';
import type { ClientDocumentKind, DocStatus } from '../../../internal-api/src/modules/clients/client-onboarding';

/**
 * Client onboarding — the rule Compliance enforces.
 *
 * Tests the API's own module (it is dependency-free, like the order ladder,
 * so a portal test can import it directly). What is being pinned is the part
 * with consequences: which papers a client owes, when they may be cleared,
 * and — the point of the whole feature — that work cannot be booked against a
 * client nobody has checked.
 */

const docs = (entries: [ClientDocumentKind, DocStatus][]) =>
  new Map<ClientDocumentKind, DocStatus>(entries);

describe('which papers a client owes', () => {
  it('asks a contract client for the signed rate agreement', () => {
    expect(requiredDocumentKinds('CONTRACT')).toContain('SIGNED_AGREEMENT');
  });

  it('does NOT ask a spot client for one — there is no rate contract to sign', () => {
    // A spot load is priced per indent against a written confirmation on the
    // indent itself (BR-26), so demanding a rate contract would be asking for
    // a document that does not exist.
    expect(requiredDocumentKinds('SPOT')).not.toContain('SIGNED_AGREEMENT');
  });

  it('asks everyone for GST, PAN and a credit check', () => {
    for (const engagement of ['SPOT', 'CONTRACT']) {
      expect(requiredDocumentKinds(engagement)).toEqual(
        expect.arrayContaining(['GST_CERTIFICATE', 'PAN', 'CREDIT_CHECK']),
      );
    }
  });
});

describe('the clearance checklist', () => {
  it('will not clear a client with a paper missing', () => {
    const gate = onboardingGate('SPOT', docs([['GST_CERTIFICATE', 'VERIFIED']]));
    expect(gate.canActivate).toBe(false);
    expect(gate.unmet.map((u) => u.state)).toContain('MISSING');
  });

  it('will not clear a client whose paper is uploaded but unchecked', () => {
    const gate = onboardingGate(
      'SPOT',
      docs([
        ['GST_CERTIFICATE', 'VERIFIED'],
        ['PAN', 'PENDING'],
        ['CREDIT_CHECK', 'VERIFIED'],
      ]),
    );
    expect(gate.canActivate).toBe(false);
    expect(gate.unmet[0].state).toBe('UNVERIFIED');
  });

  it('will not clear a client whose paper was rejected', () => {
    const gate = onboardingGate(
      'SPOT',
      docs([
        ['GST_CERTIFICATE', 'VERIFIED'],
        ['PAN', 'VERIFIED'],
        ['CREDIT_CHECK', 'REJECTED'],
      ]),
    );
    expect(gate.canActivate).toBe(false);
    expect(gate.unmet[0].state).toBe('REJECTED');
    // The reason has to be actionable, not just red.
    expect(gate.unmet[0].label).toMatch(/a new one is needed/);
  });

  it('clears a client once every required paper is verified', () => {
    const gate = onboardingGate(
      'SPOT',
      docs([
        ['GST_CERTIFICATE', 'VERIFIED'],
        ['PAN', 'VERIFIED'],
        ['CREDIT_CHECK', 'VERIFIED'],
      ]),
    );
    expect(gate.canActivate).toBe(true);
    expect(gate.unmet).toHaveLength(0);
    expect(gate.cleared).toHaveLength(3);
  });

  it('a contract client with the same three papers is still not cleared', () => {
    // The difference that makes the per-client rule worth having.
    const same = docs([
      ['GST_CERTIFICATE', 'VERIFIED'],
      ['PAN', 'VERIFIED'],
      ['CREDIT_CHECK', 'VERIFIED'],
    ]);
    expect(onboardingGate('SPOT', same).canActivate).toBe(true);
    expect(onboardingGate('CONTRACT', same).canActivate).toBe(false);
  });
});

describe('the gate that gives onboarding teeth', () => {
  /*
   * Before this existed a client was created straight to ACTIVE and loads
   * could be booked against them immediately — no papers, no check, nobody's
   * sign-off. Without this rule the whole pipeline would be a form somebody
   * fills in while work carries on regardless.
   */
  it('only an ACTIVE client can have loads raised against them', () => {
    expect(canRaiseIndent('ACTIVE')).toBe(true);
    for (const status of ['DRAFT', 'PENDING_VERIFICATION', 'REJECTED', 'INACTIVE'] as const) {
      expect(canRaiseIndent(status), `${status} must be refused`).toBe(false);
    }
  });

  it('says why, in words an operator can act on', () => {
    expect(indentBlockReason('ACTIVE')).toBeNull();
    for (const status of ['DRAFT', 'PENDING_VERIFICATION', 'REJECTED', 'INACTIVE'] as const) {
      const reason = indentBlockReason(status);
      // A refusal with no reason is a dead end — the operator is left with
      // "no" and nowhere to go.
      expect(reason, `${status} needs a reason`).toBeTruthy();
      expect(reason!.length).toBeGreaterThan(30);
    }
  });

  it('the four blocked states each say something different', () => {
    const reasons = (['DRAFT', 'PENDING_VERIFICATION', 'REJECTED', 'INACTIVE'] as const).map((s) =>
      indentBlockReason(s),
    );
    expect(new Set(reasons).size).toBe(4);
  });
});
