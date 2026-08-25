import { test, expect, Locator } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Compliance desk — `/compliance` (`src/app/compliance/page.tsx`).
 *
 * Module access (`MODULE_ACCESS.compliance`, `src/lib/permissions.ts`):
 * only COMPLIANCE (EDIT) and FINANCE (VIEW) reach this screen at all — every
 * other role gets the lock panel, already covered by `rbac-nav.spec.ts`.
 * This file focuses on what the desk itself renders: one queue in three
 * segments (`GET /compliance/queues`, mirrored in `src/mocks/index.ts`),
 * pinned to `src/mocks/db.ts` fixture data.
 *
 * The page never mutates in place — each row's action is a `<Link>` that
 * navigates to where the real decision happens (the vendor file, the
 * client, the trip's documents tab). So "read-only" is structurally true
 * for every role; the FINANCE case below confirms it holds for the VIEW role too.
 */

const panel = (main: Locator, title: string): Locator =>
  main.locator('.surface').filter({ has: main.page().getByRole('heading', { name: title, exact: true }) });

test.describe('Compliance desk — COMPLIANCE role', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/compliance');
  });

  test('renders all three queues with the seeded row counts', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByRole('heading', { name: 'Document checks' })).toBeVisible();
    await expect(panel(main, 'Vendor files').locator('table.table tbody tr')).toHaveCount(2);
    await expect(panel(main, 'Client contracts').locator('table.table tbody tr')).toHaveCount(2);
    await expect(panel(main, 'Trip documents awaiting verification').locator('table.table tbody tr')).toHaveCount(1);
  });

  test('vendor files queue lists the two unverified vendor files, not the active one', async ({ page }) => {
    const main = page.locator('main');
    const queue = panel(main, 'Vendor files');

    const rathod = queue.locator('tr').filter({ hasText: 'VND-2214' });
    await expect(rathod).toContainText('Rathod Roadlines');
    await expect(rathod).toContainText('4 of 4 identity checks verified · 3 of 5 documents verified');
    await expect(rathod).toContainText('4 days');
    await expect(rathod).toContainText('Blocked');
    await expect(rathod.getByRole('link', { name: 'Open file' })).toHaveAttribute('href', '/vendors/v-2214');

    const saiKripa = queue.locator('tr').filter({ hasText: 'VND-2287' });
    await expect(saiKripa).toContainText('Sai Kripa Carriers');
    await expect(saiKripa).toContainText('3 of 4 identity checks verified · 2 of 3 documents verified');
    await expect(saiKripa).toContainText('Blocked');

    // VND-2301 (Bhagwati Logistics) is already ACTIVE — cleared, so it never queues here.
    await expect(queue).not.toContainText('VND-2301');
  });

  test('client contracts queue lists only the two CONTRACT-engagement clients', async ({ page }) => {
    const main = page.locator('main');
    const queue = panel(main, 'Client contracts');

    const berger = queue.locator('tr').filter({ hasText: 'CLT-0092' });
    await expect(berger).toContainText('Berger Paints · rate contract BRG/RC/2026-27');
    await expect(berger).toContainText('2 lanes priced');
    await expect(berger).toContainText('Yours to approve');
    await expect(berger.getByRole('link', { name: 'Decide' })).toHaveAttribute('href', '/clients/c-0092');

    const apex = queue.locator('tr').filter({ hasText: 'CLT-0090' });
    await expect(apex).toContainText('Apex Ceramics · rate contract APX/RC/2026');
    await expect(apex).toContainText('1 lanes priced');

    // Sanghvi Metals (CLT-0088) is SPOT engagement — never has a rate contract to decide.
    await expect(queue).not.toContainText('Sanghvi Metals');
  });

  test('trip documents queue lists only the trip with a document pending verification', async ({ page }) => {
    const main = page.locator('main');
    const queue = panel(main, 'Trip documents awaiting verification');

    const row = queue.locator('tr').filter({ hasText: 'TRP-120881' });
    await expect(row).toContainText('Nashik → Kolkata');
    await expect(row).toContainText('1 document(s) uploaded and waiting · blocking the advance');
    await expect(row).toContainText('1 day');
    await expect(row).toContainText('Blocking money');
    await expect(row.getByRole('link', { name: 'Verify' })).toHaveAttribute('href', '/trips/t-120881/documents');

    // Every other seeded trip has no documents at all, so only one row queues here.
    await expect(queue.locator('table.table tbody tr')).toHaveCount(1);
  });

  test('COMPLIANCE has EDIT on this module — no read-only badge', async ({ page }) => {
    const main = page.locator('main');
    await expect(main.getByTestId('view-only')).toHaveCount(0);
  });
});

test.describe('Compliance desk — FINANCE (VIEW) role', () => {
  test('FINANCE sees the same queues, marked read-only, with no mutating controls', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/compliance');
    const main = page.locator('main');

    await expect(main.getByTestId('view-only')).toBeVisible();

    // The desk only ever offers navigation (`<Link>`s styled as buttons) to
    // go act elsewhere — never an in-place mutating <button> — for any role.
    await expect(main.locator('button')).toHaveCount(0);

    await expect(panel(main, 'Vendor files').locator('table.table tbody tr')).toHaveCount(2);
    await expect(panel(main, 'Client contracts').locator('table.table tbody tr')).toHaveCount(2);
    await expect(panel(main, 'Trip documents awaiting verification').locator('table.table tbody tr')).toHaveCount(1);

    // Navigation links are still present — read-only means no mutation, not no access.
    await expect(main.getByRole('link', { name: 'Open file' }).first()).toBeVisible();
  });
});
