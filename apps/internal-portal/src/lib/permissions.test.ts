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
  it('gives ADMIN no access to the operational "today" queue', () => {
    expect(levelFor('today', 'ADMIN')).toBe('NONE');
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
  it('ADMIN sees a minimal, mostly-governance nav', () => {
    const labels = navFor('ADMIN').flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toEqual(
      expect.arrayContaining(['Vendors', 'Approvals', 'Control panel', 'Roles matrix', 'Import']),
    );
    expect(labels).not.toContain('Today');
    expect(labels).not.toContain('Advance');
  });
  it('OPS sees the operational nav but not payments/invoicing/admin', () => {
    const labels = navFor('OPS').flatMap((g) => g.items.map((i) => i.label));
    expect(labels).toEqual(expect.arrayContaining(['Today', 'Indents', 'Trips', 'RFQ']));
    expect(labels).not.toContain('Advance');
    expect(labels).not.toContain('Control panel');
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
