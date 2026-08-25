import { describe, it, expect } from 'vitest';
import {
  FIXED_PERMISSIONS,
  GRANTABLE_ANYWHERE,
  levelFor,
  moduleForPath,
  navFor,
  ROLE_CODES,
} from './permissions';

describe('levelFor', () => {
  it('returns EDIT for a role that owns the module', () => {
    expect(levelFor('indents', 'OPS')).toBe('EDIT');
  });
  it('returns VIEW for a role with read-only access', () => {
    expect(levelFor('indents', 'FINANCE')).toBe('VIEW');
  });
  it('returns NONE for a role with no access', () => {
    expect(levelFor('payments', 'OPS')).toBe('NONE');
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
    expect(hrefs).toEqual(expect.arrayContaining(['/today', '/indents', '/trips', '/rfq']));
    expect(hrefs).not.toContain('/payments/advance');
    expect(hrefs).not.toContain('/admin');
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
