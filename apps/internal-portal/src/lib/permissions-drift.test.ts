import { describe, it, expect } from 'vitest';
import { PERMISSIONS, SEED_GRANTS, ROLES, type Permission } from './permissions';
// The API's copy of the same table, imported straight out of internal-api.
// `roles.constants.ts` is a plain constants module with no NestJS in it, for
// exactly this reason.
import {
  INTERNAL_ROLES,
  SEED_GRANTS as API_SEED_GRANTS,
} from '../../../internal-api/src/modules/roles/roles.constants';

/**
 * The role table exists twice.
 *
 * `permissions.ts` here drives the portal's nav and gate controls;
 * `roles.constants.ts` in internal-api answers `GET /admin/roles`. The API
 * file's own header calls this one authoritative — but nothing checked, and
 * they drifted: the API said admin held `config.manage` and nothing else while
 * this file granted it nineteen permissions, so the endpoint reported an
 * administrator who could do one thing.
 *
 * That is the same shape as every other bug found in this codebase today —
 * two representations of one fact, only one of them exercised. This is the
 * cheap fix: not a better comment, a test that fails.
 */

describe('the portal and the API agree on the role table', () => {
  it('has the same roles on both sides', () => {
    expect([...INTERNAL_ROLES].sort()).toEqual(Object.keys(ROLES).sort());
  });

  for (const role of Object.keys(SEED_GRANTS)) {
    it(`grants ${role} the same permissions on both sides`, () => {
      const portal = [...SEED_GRANTS[role as keyof typeof SEED_GRANTS]].sort();
      const api = [...(API_SEED_GRANTS[role as keyof typeof API_SEED_GRANTS] ?? [])].sort();
      expect(api, `roles.constants.ts disagrees with permissions.ts for ${role}`).toEqual(portal);
    });
  }

  it('grants nothing the permission list does not define', () => {
    // Catches a typo'd code, which would otherwise fail silently: a grant for
    // a permission that does not exist simply never matches anything.
    const known = new Set<string>(PERMISSIONS as readonly string[]);
    for (const [role, codes] of Object.entries(API_SEED_GRANTS)) {
      for (const code of codes) {
        expect(known.has(code), `${role} is granted unknown permission "${code}"`).toBe(true);
      }
    }
  });

  it('keeps rate.revise off every desk that can approve a contract', () => {
    /*
     * The separation this whole feature rests on. `RATE_REVISION` approvals
     * require `approve.contract`; if a desk held both, it could propose a
     * client rate change and then countersign its own proposal.
     */
    for (const [role, codes] of Object.entries(SEED_GRANTS)) {
      const list = codes as readonly Permission[];
      const both = list.includes('rate.revise' as Permission) && list.includes('approve.contract' as Permission);
      expect(both, `${role} can both propose and approve a rate revision`).toBe(false);
    }
  });
});
