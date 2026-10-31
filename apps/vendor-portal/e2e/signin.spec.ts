import { test, expect } from '@playwright/test';

/**
 * The front door. Every other spec starts already signed in, which is how a
 * blank screen straight after a first sign-in reached the live site: nothing
 * walked in the way a transporter does.
 */
test.use({ storageState: { cookies: [], origins: [] } });

const EMAIL = 'transporter@demo.nexraah.in';
const PASSWORD = 'nexraah';

test.describe('signing in', () => {
  for (const start of ['/loads', '/', '/trips']) {
    test(`arriving signed out at ${start} ends on a working screen, not a blank one`, async ({ page }) => {
      await page.goto(start);
      await expect(page).toHaveURL(/\/signin$/, { timeout: 15_000 });

      await page.getByLabel('Your email').fill(EMAIL);
      await page.getByLabel('Password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign in', exact: true }).click();

      await expect(page).toHaveURL(/\/loads$/, { timeout: 15_000 });
      await expect(page.getByRole('button', { name: /Account and profile/ })).toBeVisible();
    });
  }

  test('the demo login fills itself in', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('button', { name: 'Fill it in for me' }).click();
    await expect(page.getByLabel('Your email')).toHaveValue(EMAIL);
  });

  test('a wrong password says so and stays put', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('Your email').fill(EMAIL);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.signin-error')).toContainText('That email and password do not match a login.');
    await expect(page).toHaveURL(/\/signin$/);
  });

  test('a mobile number is not a login any more, and it says what is', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('Your email').fill('9876543210');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.signin-error')).toContainText('Enter your email address');
  });

  test('signing out and back in works', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('Your email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: /Account and profile/ }).click();
    await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/signin$/, { timeout: 15_000 });

    await page.getByLabel('Your email').fill(EMAIL);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('button', { name: /Account and profile/ })).toBeVisible({ timeout: 15_000 });
  });
});
