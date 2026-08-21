import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The sidebar filters `NAV` (lib/permissions.ts) through `levelFor(module, role)`
 * — a module the role lacks is absent, never greyed (part 01 §2.2). These
 * cases pin the exact nav set per role against the module matrix (`BR-29`),
 * so a matrix edit that silently changes a role's visibility fails loudly.
 */

interface RoleCase {
  role: 'OPS' | 'COMPLIANCE' | 'FINANCE' | 'BRANCH_MGR' | 'LEADERSHIP' | 'ADMIN';
  landsOn: string;
  visible: string[];
  hidden: string[];
}

const CASES: RoleCase[] = [
  {
    role: 'OPS',
    landsOn: '/today',
    visible: ['Today', 'Home', 'Vendors', 'Telematics', 'Clients', 'RFQ', 'Indents', 'Trips', 'POD receiving', 'POD pending', 'Approvals'],
    hidden: ['Compliance desk', 'Advance', 'Balance', 'Transporter bills', 'Invoices', 'Receivables', 'P&L', 'Control panel', 'Roles matrix', 'Import'],
  },
  {
    role: 'COMPLIANCE',
    landsOn: '/compliance',
    visible: ['Today', 'Home', 'Compliance desk', 'Vendors', 'Telematics', 'Clients', 'RFQ', 'Indents', 'Trips', 'POD receiving', 'POD pending', 'Approvals'],
    hidden: ['Advance', 'Balance', 'Transporter bills', 'Invoices', 'Receivables', 'P&L', 'Control panel', 'Roles matrix', 'Import'],
  },
  {
    role: 'FINANCE',
    landsOn: '/payments/balance',
    visible: [
      'Today', 'Home', 'Compliance desk', 'Vendors', 'Clients', 'RFQ', 'Indents', 'Trips', 'POD receiving', 'POD pending',
      'Advance', 'Balance', 'Transporter bills', 'Invoices', 'Receivables', 'P&L', 'Approvals',
    ],
    hidden: ['Telematics', 'Control panel', 'Roles matrix', 'Import'],
  },
  {
    role: 'BRANCH_MGR',
    landsOn: '/today',
    visible: [
      'Today', 'Home', 'Vendors', 'Telematics', 'Clients', 'RFQ', 'Indents', 'Trips', 'POD receiving', 'POD pending',
      'Advance', 'Balance', 'Transporter bills', 'Invoices', 'Receivables', 'P&L', 'Approvals',
    ],
    hidden: ['Compliance desk', 'Control panel', 'Roles matrix', 'Import'],
  },
  {
    role: 'LEADERSHIP',
    landsOn: '/home',
    visible: [
      'Today', 'Home', 'Vendors', 'Telematics', 'Clients', 'RFQ', 'Indents', 'Trips', 'POD receiving', 'POD pending',
      'Advance', 'Balance', 'Transporter bills', 'Invoices', 'Receivables', 'P&L', 'Approvals', 'Control panel', 'Roles matrix', 'Import',
    ],
    hidden: ['Compliance desk'],
  },
  {
    role: 'ADMIN',
    landsOn: '/admin',
    visible: ['Vendors', 'Approvals', 'Control panel', 'Roles matrix', 'Import'],
    hidden: ['Today', 'Home', 'Compliance desk', 'Telematics', 'Clients', 'RFQ', 'Indents', 'Trips', 'POD receiving', 'POD pending', 'Advance', 'Balance', 'Transporter bills', 'Invoices', 'Receivables', 'P&L'],
  },
];

for (const { role, landsOn, visible, hidden } of CASES) {
  test(`${role} sees exactly its module set in the sidebar`, async ({ page }) => {
    await setRole(page, role);
    await page.goto(landsOn);
    const nav = page.locator('nav');

    for (const label of visible) {
      await expect(nav.getByText(label, { exact: true }), `${role} should see "${label}"`).toBeVisible();
    }
    for (const label of hidden) {
      await expect(nav.getByText(label, { exact: true }), `${role} should NOT see "${label}"`).toHaveCount(0);
    }
  });
}

test('OPS hitting an ADMIN-only route directly gets the lock panel, not a 500', async ({ page }) => {
  await setRole(page, 'OPS');
  await page.goto('/admin');
  await expect(page.getByText('Control panel is not part of')).toBeVisible();
  await expect(page.getByText('It belongs to ADMIN')).toBeVisible();
});

test('ADMIN hitting an OPS-only route directly gets the lock panel', async ({ page }) => {
  await setRole(page, 'ADMIN');
  await page.goto('/today');
  await expect(page.getByText('is not part of the Administrator console')).toBeVisible();
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
  await page.getByRole('link', { name: 'Indents' }).click();
  await expect(page).toHaveURL(/\/indents$/);
  // FINANCE is VIEW-only on indents — the read-only badge should show.
  await expect(page.getByText('Read-only for FINANCE')).toBeVisible();
});
