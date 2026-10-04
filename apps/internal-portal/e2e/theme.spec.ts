import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The dark-mode switch (`lib/theme.ts`, `UserBar` in `app/shell.tsx`).
 *
 * The palette itself (`:root[data-theme='dark']` in globals.css) predates
 * this switch by some time — nothing ever set the attribute it keys off, so
 * it was unreachable from the running app. These pin the two things that
 * make it reachable: the switch actually flips `<html data-theme>`, and the
 * choice survives a reload (the blocking script in `layout.tsx` re-applies
 * it before first paint, so a reload should never show a flash of light mode
 * first — that isn't asserted here since Playwright can't observe pre-paint
 * state, but the persisted value is).
 *
 * The switch is on the top bar at every width — the desktop bar above the
 * page, the phone bar beside the menu button — so nothing has to be opened
 * to reach it. Only one of the two bars is displayed at a time.
 */
test.describe('dark mode switch', () => {
  test('defaults to light, and the switch turns <html data-theme> dark and back', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/today');

    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme', 'dark');

    const toggle = page.getByRole('switch', { name: 'Dark mode' });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.click();
    await expect(html).not.toHaveAttribute('data-theme', 'dark');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  test('persists across a reload and across a different page', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/today');
    await page.getByRole('switch', { name: 'Dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    // The stored choice is per-browser, not per-role or per-page — it should
    // hold on a screen the switch was never clicked from.
    await page.goto('/vendors');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute('aria-checked', 'true');
  });
});
