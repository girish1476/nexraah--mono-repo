import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * One invoice for several vehicles (10 Oct 2026).
 *
 * From "Ready to invoice", several loads of one client are ticked and raised as
 * one invoice; on the invoice form every load of the client can be ticked at
 * once. The printed invoice has a row for each vehicle, with its LR number.
 *
 * Fixture facts (`src/mocks/db.ts`): Berger Paints has two unbilled loads —
 * 120881 (MH 15 GT 4482, ₹64,200) and 120874 (MH 12 QR 8841, ₹22,400);
 * Apex Ceramics has two of its own.
 */

test.describe('one invoice for several vehicles', () => {
  test('tick loads on Ready to invoice, raise one invoice, and it prints a row per vehicle', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices');

    const ready = page.locator('div.surface').filter({ has: page.getByRole('heading', { name: /Ready to invoice/ }) });
    const row = (code: string) => ready.locator('tbody tr').filter({ hasText: code });
    await expect(ready.locator('[data-bulk-invoice]')).toHaveCount(0);

    await row('120881').locator('input[type="checkbox"]').check();
    const bar = ready.locator('[data-bulk-invoice]');
    await expect(bar).toContainText('1 vehicle selected');
    await expect(bar).toContainText('Berger Paints');

    // An invoice goes to one client: another client's load cannot be ticked with it.
    await expect(row('120855').locator('input[type="checkbox"]')).toBeDisabled();

    // The client's other load, in one press.
    await bar.getByRole('button', { name: 'Select all 2 of Berger Paints' }).click();
    await expect(row('120874').locator('input[type="checkbox"]')).toBeChecked();
    await expect(bar).toContainText('2 vehicles selected');
    await expect(bar).toContainText('₹86,600');

    await bar.getByRole('link', { name: 'Raise one invoice for 2 vehicles' }).click();
    await expect(page).toHaveURL(/\/invoices\/new\?/);

    // The form opens with the client chosen and both loads ticked.
    const form = page.locator('[data-bulk-bar]');
    await expect(form).toContainText('2 vehicles on this invoice');
    await expect(form).toContainText('₹86,600');
    await page.getByRole('button', { name: 'Generate invoice' }).click();
    await expect(page).toHaveURL(/\/invoices\/inv-/);
    const id = page.url().split('/invoices/')[1].split(/[?#]/)[0];

    // In-page navigation, so the data just written is still there: the printed invoice.
    await page.evaluate((invoiceId) => {
      (window as any).next.router.push(`/print/invoice/${invoiceId}`);
    }, id);
    await expect(page.locator('[data-invoice-title]')).toBeVisible();
    await expect(page.getByText('Transportation charges (MH 15 GT 4482)')).toBeVisible();
    await expect(page.getByText('Transportation charges (MH 12 QR 8841)')).toBeVisible();
    await expect(page.getByText(/LR LR-88214/)).toBeVisible();
    await expect(page.getByText(/LR LR-88207/)).toBeVisible();
    await expect(page.getByText('LR Number: LR-88214, LR-88207')).toBeVisible();
  });

  test('on the form, Select all ticks every load of the client and Clear unticks them', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices/new');

    const bar = page.locator('[data-bulk-bar]');
    await expect(bar).toContainText('No vehicle on this invoice yet');
    const selectAll = bar.getByRole('button', { name: /^Select all/ });
    await expect(selectAll).toBeDisabled();

    // Ticking a load before choosing a client chooses its client.
    const rows = page.locator('table.table tbody tr');
    await rows.filter({ hasText: '120881' }).locator('input[type="checkbox"]').check();
    await expect(page.locator('.field').filter({ hasText: 'Client' }).locator('select').first()).toHaveValue('c-0092');
    await expect(rows).toHaveCount(2);
    await expect(bar).toContainText('1 vehicle on this invoice');

    await selectAll.click();
    await expect(bar).toContainText('2 vehicles on this invoice');
    await expect(bar).toContainText('₹86,600');
    await expect(rows.filter({ hasText: 'MH 12 QR 8841' }).locator('input[type="checkbox"]')).toBeChecked();

    await bar.getByRole('button', { name: 'Clear' }).click();
    await expect(bar).toContainText('No vehicle on this invoice yet');
    await expect(page.getByRole('button', { name: 'Generate invoice' })).toBeDisabled();
  });

  test('someone who cannot raise invoices gets no tick boxes', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/invoices');
    const ready = page.locator('div.surface').filter({ has: page.getByRole('heading', { name: /Ready to invoice/ }) });
    await expect(ready.locator('tbody tr').first()).toBeVisible();
    await expect(ready.locator('input[type="checkbox"]')).toHaveCount(0);
  });
});
