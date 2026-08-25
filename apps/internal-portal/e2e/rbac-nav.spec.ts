import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The sidebar filters `NAV` (lib/permissions.ts) through `levelFor(module, role)`
 * and keeps only what the role holds `EDIT` on — a module it lacks entirely
 * (`NONE`) is absent per §2.2's minimum, and one it only holds `VIEW` on is
 * trimmed too, so the sidebar only ever lists what the signed-in role can
 * act on. A `VIEW` module stays reachable by direct URL, in read-only form
 * — it's just not offered as a shortcut. These cases pin the exact nav set
 * per role against the module matrix (`BR-29`), so a matrix edit that
 * silently changes a role's visibility fails loudly.
 *
 * They assert on **href, not label**. What has consequences is which screens
 * a role can reach; the words above them are copy, and this console's copy is
 * deliberately rewritten whenever a clearer phrase turns up. A spec that goes
 * red every time somebody improves a label teaches people to edit the spec
 * without reading it, which is worse than having no spec. (`permissions.test.ts`
 * makes the same trade for the same reason.)
 */

interface RoleCase {
  role: 'OPS' | 'COMPLIANCE' | 'FINANCE' | 'BRANCH_MGR' | 'LEADERSHIP' | 'ADMIN';
  landsOn: string;
  visible: string[];
  hidden: string[];
}

const ALL_ROUTES = [
  '/today',
  '/home',
  '/orders',
  '/compliance',
  '/vendors',
  '/telematics',
  '/clients',
  '/rfq',
  '/indents',
  '/trips',
  '/pod/receiving',
  '/pod/pending',
  '/payments/advance',
  '/payments/balance',
  '/invoices',
  '/receivables',
  '/pnl',
  '/admin/approvals',
  '/admin',
  '/admin/roles',
  '/admin/branches',
  '/admin/import',
];

/** Everything in the console that this role should not be offered. */
const allBut = (visible: string[]) => ALL_ROUTES.filter((r) => !visible.includes(r));

const CASES: RoleCase[] = [
  {
    role: 'OPS',
    landsOn: '/today',
    visible: ['/today', '/orders', '/indents', '/trips', '/rfq', '/telematics', '/vendors'],
    hidden: [],
  },
  {
    role: 'COMPLIANCE',
    landsOn: '/compliance',
    visible: [
      '/today',
      '/orders',
      '/compliance',
      '/vendors',
      '/indents',
      '/trips',
      '/pod/receiving',
      '/pod/pending',
      // Compliance holds EDIT on payments so it can clear the advance
      // document checklist. `payment.release` still lives only with Finance.
      '/payments/advance',
      '/payments/balance',
      '/admin/approvals',
    ],
    hidden: [],
  },
  {
    role: 'FINANCE',
    landsOn: '/payments/balance',
    visible: [
      '/home',
      '/orders',
      '/clients',
      '/payments/advance',
      '/payments/balance',
      '/invoices',
      '/receivables',
      '/pnl',
      '/admin/approvals',
    ],
    hidden: [],
  },
  {
    role: 'BRANCH_MGR',
    landsOn: '/today',
    visible: [
      '/today',
      '/home',
      '/orders',
      '/vendors',
      '/indents',
      '/trips',
      '/pod/receiving',
      '/pod/pending',
      '/rfq',
      '/telematics',
      '/admin/approvals',
    ],
    hidden: [],
  },
  {
    role: 'LEADERSHIP',
    landsOn: '/home',
    visible: ['/home', '/orders', '/rfq', '/pnl', '/admin/approvals'],
    hidden: [],
  },
  {
    // ADMIN is EDIT on every module — the full console, every row shown.
    // What ADMIN still can't *do* (release a payment, waive a POD penalty,
    // submit an RFQ, decide an approval) is enforced by SEED_GRANTS, not by
    // hiding the row — see admin.spec.ts's approvals-audit-view test.
    role: 'ADMIN',
    landsOn: '/admin',
    visible: ALL_ROUTES,
    hidden: [],
  },
];

for (const { role, landsOn, visible } of CASES) {
  test(`${role} sees exactly its module set in the sidebar`, async ({ page }) => {
    await setRole(page, role);
    await page.goto(landsOn);
    const nav = page.locator('nav');

    for (const href of visible) {
      await expect(
        nav.locator(`a[href="${href}"]`),
        `${role} should be offered ${href}`,
      ).toHaveCount(1);
    }
    for (const href of allBut(visible)) {
      await expect(
        nav.locator(`a[href="${href}"]`),
        `${role} should NOT be offered ${href}`,
      ).toHaveCount(0);
    }
  });
}

test('OPS hitting an ADMIN-only route directly gets the lock panel, not a 500', async ({ page }) => {
  await setRole(page, 'OPS');
  await page.goto('/admin');
  await expect(page.getByText('is not part of the Operations desk console')).toBeVisible();
  // The owning desk is named in words a person can act on, never as a role code.
  await expect(page.getByText(/It belongs to Administrator/)).toBeVisible();
  await expect(page.getByText('ADMIN', { exact: true })).toHaveCount(0);
});

test('ADMIN hitting an operational route directly gets the real screen, never a lock panel', async ({ page }) => {
  await setRole(page, 'ADMIN');
  await page.goto('/today');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/is not part of the .* console/)).toHaveCount(0);
});

test('FINANCE hitting the telematics route (no access) gets the lock panel', async ({ page }) => {
  await setRole(page, 'FINANCE');
  await page.goto('/telematics');
  await expect(page.getByText('is not part of the Finance console')).toBeVisible();
});

test('role switcher persists across a client-side navigation', async ({ page }, testInfo) => {
  await setRole(page, 'FINANCE');
  await page.goto('/payments/balance');
  // Below the drawer breakpoint the sidebar starts off-canvas — the mobile
  // nav suite covers drawer mechanics; this test is about role persistence.
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  // FINANCE holds EDIT on clients (unlike indents, which is VIEW-only and no
  // longer offered in the sidebar) — a client-side route change carries the
  // same role forward, so the create control is there, not a lock panel.
  await page.locator('nav a[href="/clients"]').click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole('link', { name: 'New client' })).toBeVisible();
});
