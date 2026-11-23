import { test, expect, Page } from '@playwright/test';
import { mintAccessToken } from '../src/mocks';
import type { RoleCode } from '../src/lib/permissions';

/**
 * HR in the browser: the HR login's own desk, My HR for every desk, a
 * check-in checked against the office, leave from request to approval, and
 * a payroll month from calculation to a released payslip.
 *
 * Each test starts from a fresh browser, so HR's sample data starts fresh too.
 */

// Standing in the Visakhapatnam office.
test.use({ geolocation: { latitude: 17.6869, longitude: 83.2187 }, permissions: ['geolocation'] });

const as = (page: Page, role: RoleCode) =>
  page.addInitScript((token) => window.localStorage.setItem('token', token), mintAccessToken(role));

test('the HR login lands on People and sees no freight screens', async ({ page }) => {
  await as(page, 'HR');
  await page.goto('/');
  await expect(page).toHaveURL(/\/hr$/);
  await expect(page.getByText(/on the rolls/).first()).toBeVisible();
  await page.goto('/orders');
  await expect(page).toHaveURL(/\/hr$/);
});

test('a freight desk has My HR but not the HR desk', async ({ page }) => {
  await as(page, 'COMPLIANCE');
  await page.goto('/me');
  await expect(page.getByRole('button', { name: /Check in|Check out|Done/ })).toBeVisible();
  await page.goto('/hr/payroll');
  await expect(page).not.toHaveURL(/\/hr\//);
});

test('checking in at the office marks the day', async ({ page }) => {
  await as(page, 'FINANCE');
  await page.goto('/me');
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText(/Checked in at/)).toBeVisible();
  await expect(page.getByText(/At Visakhapatnam \(HO\)/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check out' })).toBeVisible();
});

test('leave goes to the manager, who approves it from My HR', async ({ page }) => {
  // Ravi Kumar (loading supervisor) reports to Anil Deshmukh (Operations).
  await as(page, 'LOADING_SUPERVISOR');
  await page.goto('/me/leave?apply=1');
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /Privilege leave/ }).click();
  const first = new Date(Date.now() + 20 * 86_400_000);
  while ([0, 6].includes(first.getUTCDay())) first.setUTCDate(first.getUTCDate() + 1);
  const day = first.toISOString().slice(0, 10);
  await dialog.locator('input[type="date"]').first().fill(day);
  await dialog.getByPlaceholder(/Sister/).fill('Family function');
  await dialog.getByRole('button', { name: /Ask for 1 day/ }).click();
  await expect(page.getByText(/Sent to Anil Deshmukh/)).toBeVisible();

  // Same browser, so the request is there when the manager signs in.
  await page.evaluate((token) => window.localStorage.setItem('token', token), mintAccessToken('OPS'));
  await page.addInitScript((token) => window.localStorage.setItem('token', token), mintAccessToken('OPS'));
  await page.goto('/me');
  const row = page.locator('.hr-row').filter({ hasText: 'Ravi Kumar' }).filter({ hasText: 'Family function' });
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved — Ravi Kumar has been told/)).toBeVisible();
});

test('payroll: HR prepares November, Leadership approves, the payslip is released', async ({ page }) => {
  await as(page, 'HR');
  await page.goto('/hr/payroll');
  await page.getByRole('button', { name: /Calculate November/ }).click();
  await expect(page).toHaveURL(/\/hr\/payroll\/run-/);
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(page.getByText('Sent to Leadership for approval')).toBeVisible();
  const url = page.url();

  await page.evaluate((token) => window.localStorage.setItem('token', token), mintAccessToken('LEADERSHIP'));
  await page.addInitScript((token) => window.localStorage.setItem('token', token), mintAccessToken('LEADERSHIP'));
  await page.goto(url);
  await page.getByRole('button', { name: /Approve November/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved — release/)).toBeVisible();
  await page.getByRole('button', { name: 'Release payslips' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Release' }).click();
  await expect(page.getByText(/Payslips released/)).toBeVisible();

  await page.goto('/me/payslips');
  await expect(page.getByText('November 2026').first()).toBeVisible();
});

test('each month’s payslip downloads as a Nexraah payslip PDF', async ({ page }) => {
  await as(page, 'OPS');
  await page.goto('/me/payslips');
  const row = page.locator('[data-payslip-month]').first();
  await expect(row).toBeVisible();
  const month = await row.getAttribute('data-payslip-month');

  const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: /Download PDF/ }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^Nexraah-Payslip-[A-Za-z0-9-]+-${month}\.pdf$`));
  const path = await download.path();
  const bytes = require('node:fs').readFileSync(path);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const text = bytes.toString('latin1');
  expect(text).toContain('PAYSLIP');
  expect(text).toContain('Anil Deshmukh');
  expect(text).toContain('NET PAY FOR');
});
