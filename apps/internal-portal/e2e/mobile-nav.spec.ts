import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

// This drawer only renders below the 900px breakpoint — skip on desktop
// projects instead of forcing a viewport here (that would fight the
// project's own device settings when the whole suite runs unfiltered).
test.describe('mobile nav drawer', () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'drawer only exists below the 900px breakpoint');
  });

  test('sidebar is off-canvas by default and the hamburger opens it', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/today');
    const sidebar = page.locator('aside.sidebar');
    await expect(sidebar).not.toHaveClass(/open/);

    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(sidebar).toHaveClass(/open/);
    // "Today" was renamed "My desk" in the 2026-09-19 label pass.
    await expect(page.getByRole('link', { name: /^My desk/ })).toBeVisible();
  });

  test('tapping the backdrop closes the drawer', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/today');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.locator('aside.sidebar')).toHaveClass(/open/);

    await page.locator('.nav-backdrop').click({ position: { x: 350, y: 400 }, force: true });
    await expect(page.locator('aside.sidebar')).not.toHaveClass(/open/);
  });

  test('the close (X) button closes the drawer', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/today');
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('button', { name: 'Close menu' }).click();
    await expect(page.locator('aside.sidebar')).not.toHaveClass(/open/);
  });

  test('navigating via a drawer link closes the drawer on arrival', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/today');
    await page.getByRole('button', { name: 'Open menu' }).click();
    // The standalone "Trips on the road" row this used to click was pulled
    // for every role in the 2026-09-02 nav rebuild — a trip is reached
    // through search, orders or its own load request now, never a sidebar
    // shortcut (see the note on `ALL_ROUTES` in rbac-nav.spec.ts). Load
    // requests is one of the rows OPS still holds EDIT on. Scoped to the
    // drawer itself — "My desk" also links a same-named quick-card to it.
    await page.locator('aside.sidebar').getByRole('link', { name: /^Load requests/ }).click();
    await expect(page).toHaveURL(/\/indents$/);
    await expect(page.locator('aside.sidebar')).not.toHaveClass(/open/);
  });

  test('data tables collapse to stacked cards on a phone viewport', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips');
    // NFR-06: the table head hides and each row becomes a bordered card;
    // data-label on every td drives the mobile pseudo-label.
    const firstCell = page.locator('table.table tbody tr').first().locator('td').first();
    await expect(firstCell).toHaveAttribute('data-label', /.+/);
    await expect(page.locator('table.table thead')).toBeHidden();
  });
});
