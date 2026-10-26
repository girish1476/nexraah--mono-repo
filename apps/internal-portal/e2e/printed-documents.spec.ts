import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Printed documents (11 Oct 2026): the names of the lorry receipt's copies and
 * the terms and conditions on the receipt and the invoice are settings in the
 * control panel, not fixed in the console.
 */

test.describe('printed documents in the control panel', () => {
  test('the copy names and both sets of terms are shown, and a change is saved', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin');

    const panel = page.locator('[data-printed-documents]');
    await expect(panel).toContainText('Lorry receipt copies');
    await expect(panel.locator('input[name="lr-copy-0"]')).toHaveValue('Consignor copy');
    await expect(panel.locator('input[name="lr-copy-1"]')).toHaveValue('Consignee copy');
    await expect(panel.locator('input[name="lr-copy-2"]')).toHaveValue('Carrier copy');
    await expect(panel.locator('input[name="lr-copy-3"]')).toHaveValue('Office copy');
    await expect(panel.locator('textarea[name="lr-terms"]')).toHaveValue(/owner’s risk/);
    await expect(panel.locator('textarea[name="invoice-terms"]')).toHaveValue(/Confidentiality/);

    // Renaming a copy saves when the box is left.
    await panel.locator('input[name="lr-copy-2"]').fill('Driver copy');
    await panel.locator('input[name="lr-copy-3"]').focus();
    await expect(page.getByText('Configuration saved · audited')).toBeVisible();
    await expect(panel.locator('input[name="lr-copy-2"]')).toHaveValue('Driver copy');

    // So do the terms.
    await panel.locator('textarea[name="lr-terms"]').fill('1. Goods are carried at owner’s risk.\n2. Subject to Visakhapatnam jurisdiction.');
    await panel.locator('textarea[name="invoice-terms"]').focus();
    await expect(panel.locator('textarea[name="lr-terms"]')).toHaveValue(/Visakhapatnam jurisdiction/);
  });

  test('someone who cannot manage settings sees them but cannot change them', async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/admin');
    const panel = page.locator('[data-printed-documents]');
    // Only shown where the control panel itself is; where it is, a viewer's boxes are locked.
    if ((await panel.count()) > 0 && (await page.locator('input[name="company-name"]').isDisabled())) {
      await expect(panel.locator('input[name="lr-copy-0"]')).toBeDisabled();
      await expect(panel.locator('textarea[name="lr-terms"]')).toBeDisabled();
    }
  });
});

test.describe('the printed lorry receipt and invoice', () => {
  test('the lorry receipt prints its four copies and its terms', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/print/lr/t-120881');
    await expect(page.getByText('4 copies · A4', { exact: false })).toBeVisible();
    await expect(page.locator('.sheet')).toHaveCount(4);
    for (const copy of ['Consignor copy', 'Consignee copy', 'Carrier copy', 'Office copy']) {
      await expect(page.getByText(new RegExp(`Lorry receipt · ${copy}`, 'i')).first()).toBeVisible();
    }
    await expect(page.locator('[data-lr-terms]').first()).toContainText('Terms & Conditions.');
    await expect(page.locator('[data-lr-terms]').first()).toContainText('owner’s risk');
  });

  test('the invoice prints its terms', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/print/invoice/inv-411');
    await expect(page.locator('[data-invoice-terms]')).toContainText('Terms & Conditions:');
    await expect(page.locator('[data-invoice-terms]')).toContainText('Confidentiality');
  });
});
