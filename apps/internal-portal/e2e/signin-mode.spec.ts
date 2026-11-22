import { test, expect } from '@playwright/test';

/**
 * Mock mode on the sign-in screen — demo-data deployments only (never preprod,
 * which runs with NEXT_PUBLIC_USE_MOCKS=0 and has no switch at all). Pick a
 * role and you are in; Live keeps the emailed-code sign-in.
 */
test.describe('sign-in: Live and Mock', () => {
  test('Mock lets anyone in as any role with one tap, and is remembered', async ({ page }) => {
    await page.goto('/signin');
    const mock = page.getByRole('radio', { name: /Mock/ });
    await expect(page.getByRole('radio', { name: /Live/ })).toHaveAttribute('aria-checked', 'true');
    await mock.click();
    await expect(page.getByRole('heading', { name: 'Pick a role' })).toBeVisible();
    await expect(page.getByLabel('Work email')).toHaveCount(0);

    await page.locator('[data-mock-role="FINANCE"]').click();
    await expect(page).not.toHaveURL(/\/signin/);
    const who = await page.evaluate(() => JSON.parse(atob((localStorage.getItem('token') ?? '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email);
    expect(who).toBe('rakesh@nexraah.in');

    // Signed out, the screen comes back in Mock.
    await page.evaluate(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('tokenExpiresAt');
    });
    await page.goto('/signin');
    await expect(page.getByRole('radio', { name: /Mock/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('every role is offered, HR and the loading supervisor included', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('radio', { name: /Mock/ }).click();
    for (const role of ['OPS', 'COMPLIANCE', 'FINANCE', 'BD', 'LEADERSHIP', 'ADMIN', 'HR', 'LOADING_SUPERVISOR']) {
      await expect(page.locator(`[data-mock-role="${role}"]`).first()).toBeVisible();
    }
    await page.locator('[data-mock-role="HR"]').click();
    await expect(page).toHaveURL(/\/hr/);
  });

  test('Live keeps the emailed-code form', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('radio', { name: /Mock/ }).click();
    await page.getByRole('radio', { name: /Live/ }).click();
    await expect(page.getByLabel('Work email')).toBeVisible();
    await expect(page.getByRole('button', { name: /Send me a code/ })).toBeVisible();
  });

  test('a mock administrator does not open the integration keys', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('radio', { name: /Mock/ }).click();
    await page.locator('[data-mock-role="ADMIN"]').click();
    await expect(page).not.toHaveURL(/\/signin/);
    await page.evaluate(() => (window as any).next.router.push('/admin/integrations'));
    await expect(page.getByText('Integrations hold real keys, so they open only after a Live sign-in')).toBeVisible();
  });
});
