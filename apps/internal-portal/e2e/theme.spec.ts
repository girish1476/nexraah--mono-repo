import { test, expect, Page, TestInfo } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The dark-mode toggle (`lib/theme.ts`, `RoleStrip` in `app/shell.tsx`).
 *
 * The palette itself (`:root[data-theme='dark']` in globals.css) predates
 * this toggle by some time — nothing ever set the attribute it keys off, so
 * it was unreachable from the running app. These pin the two things that
 * make it reachable: the button actually flips `<html data-theme>`, and the
 * choice survives a reload (the blocking script in `layout.tsx` re-applies
 * it before first paint, so a reload should never show a flash of light mode
 * first — that isn't asserted here since Playwright can't observe pre-paint
 * state, but the persisted value is).
 *
 * The toggle lives in `RoleStrip`, at the foot of the same `<aside>` the nav
 * rows sit in — off-canvas behind the hamburger below the 900px breakpoint
 * (see `mobile-nav.spec.ts`). Every navigation and reload below closes that
 * drawer, so it has to be reopened before the button is reachable there.
 */
async function openMenuIfMobile(page: Page, testInfo: TestInfo) {
  if (testInfo.project.name === 'mobile') {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
}

test.describe('dark mode toggle', () => {
  test('defaults to light, and the button switches <html data-theme> to dark and back', async ({ page }, testInfo) => {
    await setRole(page, 'OPS');
    await page.goto('/today');
    await openMenuIfMobile(page, testInfo);

    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', 'dark');

    const toggle = page.getByRole('button', { name: 'Dark mode' });
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('button', { name: 'Light mode' })).toBeVisible();

    await page.getByRole('button', { name: 'Light mode' }).click();
    await expect(html).not.toHaveAttribute('data-theme', 'dark');
  });

  test('persists across a reload and across a different page', async ({ page }, testInfo) => {
    await setRole(page, 'OPS');
    await page.goto('/today');
    await openMenuIfMobile(page, testInfo);
    await page.getByRole('button', { name: 'Dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // The stored choice is per-browser, not per-role or per-page — it should
    // hold on a screen the toggle was never clicked from.
    await page.goto('/vendors');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openMenuIfMobile(page, testInfo);
    await expect(page.getByRole('button', { name: 'Light mode' })).toBeVisible();
  });
});
