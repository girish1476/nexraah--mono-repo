import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Control → Integrations → UPI payment code: with a UPI ID saved, a printed
 * invoice carries a "scan to pay" code for what is still due. The saved
 * setting is what `/api/integrations/public` tells the browser — stubbed here,
 * since the suite has no shared database to save it in.
 */
const switches = (upi: unknown) => (route: import('@playwright/test').Route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ geocode: true, fuel: true, ifsc: true, reader: true, whatsapp: true, gps: false, googleMapsKey: null, pincode: true, distance: true, upi }),
  });

test.describe('UPI payment code on invoices', () => {
  test('a saved UPI ID puts a scan-to-pay code for the amount due on the printed invoice', async ({ page }) => {
    await page.route('**/api/integrations/public', switches({ vpa: 'nexraah@hdfcbank', payeeName: 'Nexraah Logistics' }));
    await setRole(page, 'FINANCE');
    await page.goto('/print/invoice/inv-411');
    const code = page.locator('[data-upi-qr]');
    await expect(code).toBeVisible();
    await expect(code).toContainText('Scan to pay by UPI');
    await expect(code).toContainText('nexraah@hdfcbank');
    await expect(code.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml/);
  });

  test('with no UPI ID saved, the invoice prints as before', async ({ page }) => {
    await page.route('**/api/integrations/public', switches(null));
    await setRole(page, 'FINANCE');
    await page.goto('/print/invoice/inv-411');
    await expect(page.locator('.sheet')).toBeVisible();
    await expect(page.locator('[data-upi-qr]')).toHaveCount(0);
  });
});
