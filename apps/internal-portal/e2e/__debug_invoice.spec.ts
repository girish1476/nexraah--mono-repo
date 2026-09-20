import { test } from '@playwright/test';
import { setRole } from './helpers';

test('debug invoice creation, checked without a reload', async ({ page }) => {
  await setRole(page, 'FINANCE');
  await page.goto('/invoices/new');
  await page.waitForTimeout(500);

  const clientSelect = page.locator('select').first();
  await clientSelect.selectOption({ label: 'Berger Paints' });
  await page.waitForTimeout(500);

  const checkboxes = page.locator('input[type="checkbox"]');
  await checkboxes.first().check();
  await page.waitForTimeout(300);

  await page.getByRole('button', { name: /save draft/i }).click();
  await page.waitForURL(/\/invoices\/inv-/);
  await page.waitForTimeout(500);

  const bodyText = await page.locator('main').innerText();
  console.log('=== INVOICE DETAIL PAGE TEXT ===');
  console.log(bodyText);
});
