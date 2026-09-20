import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  FIXED_PERMISSIONS,
  GRANTABLE_ANYWHERE,
  levelFor,
  moduleForPath,
  navFor,
  ROLE_CODES,
  SEED_GRANTS,
} from './permissions';

describe('levelFor', () => {
  it('returns EDIT for a role that owns the module', () => {
    expect(levelFor('indents', 'OPS')).toBe('EDIT');
  });
  it('returns VIEW for a role with read-only access', () => {
    expect(levelFor('indents', 'FINANCE')).toBe('VIEW');
  });
  it('returns NONE for a role with no access', () => {
    // `payments` used to be the example here. Operations picked up VIEW on it
    // when it absorbed the branch manager, so the module that still answers
    // NONE for Operations is the compliance desk.
    expect(levelFor('compliance', 'OPS')).toBe('NONE');
  });
  it('gives ADMIN EDIT access to every module, operational screens included', () => {
    expect(levelFor('today', 'ADMIN')).toBe('EDIT');
    expect(levelFor('payments', 'ADMIN')).toBe('EDIT');
  });
  it('gives every role a defined level for every module (matrix has no gaps)', () => {
    const modules: Parameters<typeof levelFor>[0][] = [
      'today', 'home', 'vendors', 'compliance', 'clients', 'indents', 'trips',
      'pod', 'payments', 'invoices', 'receivables', 'rfq', 'telematics', 'pnl',
      'approvals', 'admin',
    ];
    for (const m of modules) {
      for (const role of ROLE_CODES) {
        expect(['NONE', 'VIEW', 'EDIT']).toContain(levelFor(m, role));
      }
    }
  });
});

describe('navFor', () => {
  it('never includes a module the role has NONE access to', () => {
    for (const role of ROLE_CODES) {
      const groups = navFor(role);
      for (const group of groups) {
        for (const item of group.items) {
          expect(levelFor(item.module, role)).not.toBe('NONE');
        }
      }
    }
  });
  it('drops an empty group entirely rather than rendering an empty header', () => {
    for (const role of ROLE_CODES) {
      for (const group of navFor(role)) {
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });
  /*
   * These assert on `href`, not `label`. What the test is actually protecting
   * is *which screens a role can reach* — a rule with real consequences. Nav
   * wording is being rewritten repeatedly for clarity, and a test that fails
   * every time someone improves a label trains people to edit the test rather
   * than read it. The route a role can open is the invariant; the words above
   * it are not.
   */
  it('ADMIN sees the full console — every module is EDIT', () => {
    const hrefs = navFor('ADMIN').flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        '/today',
        '/vendors',
        '/payments/advance',
        '/admin/approvals',
        '/admin',
        '/admin/roles',
        '/admin/import',
      ]),
    );
  });
  it('OPS sees the operational nav but not payments/invoicing/admin', () => {
    const hrefs = navFor('OPS').flatMap((g) => g.items.map((i) => i.href));
    // `/trips` was here until the 2026-09-02 nav rebuild retired the row —
    // finding a trip is Global search's job now, and the page is still
    // reachable from a search result. The rule being protected is which
    // *areas* Operations reaches, so the row it stands on can change.
    expect(hrefs).toEqual(expect.arrayContaining(['/today', '/indents', '/rfq', '/pod/pending']));
    expect(hrefs).not.toContain('/payments/advance');
    expect(hrefs).not.toContain('/admin');
  });
  /*
   * The "start something" rows — Add a client, Add a transporter, New
   * invoice, New RFQ — used to each carry their own sidebar row alongside
   * the identical button the destination page already offers (all gated on
   * the same permission the page checks). Every one of those rows is gone
   * now: the button is the one door into each of those rooms, not a button
   * plus a second one in the sidebar. `/clients/rate-changes` (`rate.revise`)
   * is the one surviving row of this shape, so it is what these tests stand
   * on — the rule they protect ("the row appears exactly where the
   * permission behind it is held") is unchanged.
   */
  it('offers rate revision to the roles that hold rate.revise and nobody else', () => {
    /*
     * Derived from `SEED_GRANTS`, not a hand-listed set of roles. The rule this
     * protects is "the row appears exactly where the permission behind it is
     * held" — spelling out the roles instead restates today's grants, so the
     * test fails whenever the matrix is retuned even though the rule still
     * holds.
     */
    const sees = (role: (typeof ROLE_CODES)[number]) =>
      navFor(role).some((g) => g.items.some((i) => i.href === '/clients/rate-changes'));
    for (const role of ROLE_CODES) {
      expect(sees(role), `${role} nav row vs rate.revise grant`).toBe(
        SEED_GRANTS[role].includes('rate.revise'),
      );
    }
    // The rule is only meaningful while the permission is actually split.
    const holders = ROLE_CODES.filter((r) => SEED_GRANTS[r].includes('rate.revise'));
    expect(holders.length).toBeGreaterThan(0);
    expect(holders.length).toBeLessThan(ROLE_CODES.length);
  });
  it('gates creation rows on the permission of each page, per role', () => {
    const hrefs = (role: (typeof ROLE_CODES)[number]) =>
      navFor(role).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs('FINANCE')).toContain('/clients/rate-changes');
    expect(hrefs('OPS')).not.toContain('/clients/rate-changes');
    expect(hrefs('COMPLIANCE')).toContain('/vendors/leads');
    /*
     * `/indents/new`, `/vendors/new`, `/clients/new` and `/invoices/new` used
     * to be asserted here and are deliberately gone: each one's destination
     * page already carries its own identically-gated "Add"/"New" button, so
     * the sidebar row was a second door to one room.
     */
  });
  it('uses the grants the session actually carries over the role seed', () => {
    const withGrant = navFor('COMPLIANCE', ['rate.revise']).flatMap((g) => g.items.map((i) => i.href));
    expect(withGrant).toContain('/clients/rate-changes');
    const withoutGrant = navFor('OPS', []).flatMap((g) => g.items.map((i) => i.href));
    expect(withoutGrant).not.toContain('/clients/rate-changes');
    expect(withoutGrant).toContain('/vendors');
  });
  /*
   * This used to assert `/clients/onboarding` was ABSENT, because the row was
   * added before the page behind it existed and the sidebar briefly offered a
   * dead link. The page exists now (`app/clients/onboarding/page.tsx`), so the
   * premise is gone — and asserting the absence of a screen we have since
   * built would pin the console shut against its own feature.
   *
   * What it checks instead is the rule that actually matters for this row:
   * onboarding is Compliance's queue, so it follows `client.onboard` rather
   * than the `clients` module level. Finance holds EDIT on the module — they
   * own the commercial record — but not the clearance decision, and offering
   * them a queue of decisions they cannot make is exactly what the permission
   * filter exists to prevent.
   */
  it('offers client onboarding to the desk that can actually clear a client', () => {
    const compliance = navFor('COMPLIANCE').flatMap((g) => g.items.map((i) => i.href));
    expect(compliance).toContain('/clients/onboarding');

    const finance = navFor('FINANCE').flatMap((g) => g.items.map((i) => i.href));
    expect(finance).not.toContain('/clients/onboarding');
  });

  it('every nav row points at a page that exists', () => {
    // The guard the assertion above started life as, generalised: a row whose
    // route has no page is a dead link in the sidebar, and that is worth
    // catching for every row rather than for one remembered case.
    const dir = join(__dirname, '..', 'app');
    for (const role of ROLE_CODES) {
      for (const group of navFor(role)) {
        for (const item of group.items) {
          // A row may carry a preset — `/pod/pending?ageing=breached` offers
          // the past-due queue without a second screen that is the first one
          // with a filter pre-set. What must exist is the page behind the
          // path, so the query is not part of the question.
          const segments = item.href.replace(/^\//, '').split('?')[0].split('/');
          expect(
            existsSync(join(dir, ...segments, 'page.tsx')),
            `${item.href} (${item.label}) has no page.tsx`,
          ).toBe(true);
        }
      }
    }
  });
});

describe('moduleForPath', () => {
  it('matches an exact module route', () => {
    expect(moduleForPath('/trips')).toBe('trips');
  });
  it('matches a nested sub-route under the module prefix', () => {
    expect(moduleForPath('/trips/TR-20881/charges')).toBe('trips');
  });
  it('resolves the longest matching prefix, not the first', () => {
    // /admin/approvals must win over the shorter /admin prefix.
    expect(moduleForPath('/admin/approvals')).toBe('approvals');
    expect(moduleForPath('/admin/roles')).toBe('admin');
  });
  it('returns null for a path with no owning module', () => {
    expect(moduleForPath('/not-a-real-route')).toBeNull();
  });
  it('does not prefix-match unrelated routes sharing a substring', () => {
    // "/podcast" should not resolve to the "pod" module.
    expect(moduleForPath('/podcast')).toBeNull();
  });
});

describe('permission constants', () => {
  it('a fixed permission is never also listed as freely grantable', () => {
    for (const p of FIXED_PERMISSIONS) {
      expect(GRANTABLE_ANYWHERE).not.toContain(p);
    }
  });
});
