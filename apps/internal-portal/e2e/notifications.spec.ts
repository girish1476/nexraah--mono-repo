import { test, expect, type Page } from '@playwright/test';
import { setRole } from './helpers';

// The console's Dialog is a `.surface` with its title as a heading — no dialog role.
const emailDialog = (page: Page) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: 'Email for notices', level: 2 }) });

/**
 * Notifications — a transporter's "Email for notices", and the bell in the
 * user bar. The demo has no server to push from (no `VAPID_PUBLIC_KEY`, see
 * the mock's `/notifications/push-key`), so the bell must not show at all.
 */

test.describe('Notifications', () => {
  test('a transporter email for notices can be added, checked and removed', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/v-2214');
    const main = page.locator('main');
    await expect(main.getByText('Email for notices', { exact: true })).toBeVisible();
    await expect(main.getByText('Not given', { exact: true })).toBeVisible();
    await expect(main.getByText('9822014471 · 9822014472')).toBeVisible();

    await main.getByRole('button', { name: 'Add', exact: true }).click();
    const dialog = emailDialog(page);
    const email = dialog.getByRole('textbox');
    await email.fill('not-an-email');
    await expect(dialog.getByText('Enter a valid email, e.g. accounts@transporter.in')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();

    await email.fill('  Accounts@Rathod-Roadlines.in ');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Email saved · notices will go there')).toBeVisible();
    await expect(main.getByText('accounts@rathod-roadlines.in', { exact: true })).toBeVisible();

    await main.getByRole('button', { name: 'Change', exact: true }).first().click();
    await emailDialog(page).getByRole('textbox').fill('');
    await emailDialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Email removed')).toBeVisible();
    await expect(main.getByText('Not given', { exact: true })).toBeVisible();
  });

  test('a role without vendor.edit sees the email but cannot change it', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors/v-2214');
    const main = page.locator('main');
    await expect(main.getByText('Email for notices', { exact: true })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  });

  test('the onboarding form takes an optional email and refuses a bad one', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');
    await expect(main.getByText('Email for notices', { exact: true })).toBeVisible();
    await main.locator('input[type="email"]').fill('accounts@');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(main.getByText('Enter a valid email, e.g. accounts@transporter.in')).toBeVisible();
  });

  test('no notifications bell in the demo, which has nothing to send from', async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Sign out' }).first()).toBeAttached();
    await expect(page.getByRole('switch', { name: 'Browser notifications' })).toHaveCount(0);
  });
});
