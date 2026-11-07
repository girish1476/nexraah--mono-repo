import { test, expect, Page } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Control → Manual invoices (`/admin/invoices`): an administrator builds a GST
 * tax invoice by hand, or a batch from a sheet, and prints them. Berger Paints
 * (CLT-0092, GSTIN 19AAACB2545C1Z9) is the client; the demo company's GSTIN is
 * Maharashtra's (27), so West Bengal is an inter-state supply — IGST.
 */

const main = (page: Page) => page.locator('main');

/**
 * Opens a print link in this tab, in the app: the suite's sample data is not
 * saved between page loads, so a fresh tab would not have the new invoices.
 */
async function openInPage(page: Page, link: ReturnType<Page['getByRole']>) {
  await link.evaluate((a) => a.removeAttribute('target'));
  await link.click();
}

async function fillSingle(page: Page) {
  await page.getByLabel('Client', { exact: true }).selectOption({ label: 'Berger Paints · CLT-0092' });
  await page.getByLabel('State', { exact: true }).selectOption('West Bengal');
  await page.getByLabel('Place of supply').selectOption('West Bengal');
  await page.getByLabel('Consignee name').fill('Asian Depot');
  await page.getByLabel('Vehicle number').fill('wb 23 c 1199');
  await page.getByLabel('From (place of origin)').fill('Kolkata');
  await page.getByLabel('To (destination)').fill('Nashik');
  await page.getByLabel('Description of goods').fill('Paint drums');
  await page.getByLabel('Gross weight (kg)').fill('18000');
  await page.getByLabel('Line 1 description').fill('Freight, Kolkata to Nashik, 32 ft SXL');
  await page.getByLabel('Line 1 rate').fill('186000');
}

test.describe('manual invoices', () => {
  test('an administrator builds one by hand, generates it, and it prints as a full GST tax invoice', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin/invoices');
    await expect(page.getByTestId('manual-problems')).toContainText('Client is missing');
    await expect(page.getByRole('button', { name: /Generate invoice/ })).toBeDisabled();

    await fillSingle(page);
    await page.getByRole('button', { name: /Add a charge/ }).click();
    await page.getByLabel('Charge 1 name').fill('Loading charges');
    await page.getByLabel('Charge 1 amount').fill('2500');
    await expect(page.getByTestId('manual-problems')).toHaveCount(0);
    await expect(page.getByTestId('manual-total')).toContainText('1,88,500');

    await page.getByRole('button', { name: /Preview the invoice/ }).click();
    await expect(page.getByTestId('manual-preview')).toContainText('TAX INVOICE');

    await page.getByRole('button', { name: /Generate invoice/ }).click();
    const done = main(page).getByText(/Invoice NEX-INV-\S+ generated/);
    await expect(done).toBeVisible();

    await openInPage(page, main(page).getByRole('link', { name: 'Print / save as PDF' }));
    const sheet = page.locator('[data-tax-invoice]');
    await expect(sheet).toContainText('TAX INVOICE');
    await expect(sheet).toContainText('Reverse charge');
    await expect(sheet).toContainText('West Bengal (19)');
    await expect(sheet).toContainText('Maharashtra (27)');
    await expect(sheet).toContainText('WB 23 C 1199');
    await expect(sheet).toContainText('18,000 kg');
    await expect(sheet).toContainText('Asian Depot');
    await expect(sheet).toContainText('IGST @5%');
    await expect(sheet).toContainText('9,425.00'); // 5% of ₹1,88,500, paid by Berger under reverse charge
    await expect(sheet.locator('[data-invoice-total]')).toHaveText('₹1,88,500.00');
    await expect(sheet.locator('[data-amount-words]')).toHaveText('Rupees One Lakh Eighty Eight Thousand Five Hundred Only');
    await expect(sheet).toContainText('19AAACB2545C1Z9');
  });

  test('it lands in Client bills like any invoice, and Edit there opens the builder', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin/invoices');
    await fillSingle(page);
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await main(page).getByRole('link', { name: 'Open the invoice' }).click();
    await expect(page).toHaveURL(/\/invoices\/inv-/);
    await main(page).getByRole('link', { name: 'Edit' }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\?id=/);
    await expect(page.getByLabel('Consignee name')).toHaveValue('Asian Depot');
    await page.getByLabel('Gross weight (kg)').fill('18500');
    await page.getByRole('button', { name: /Generate invoice/ }).click();
    await expect(main(page).getByText(/Invoice NEX-INV-\S+ generated/)).toBeVisible();
  });

  test('a sheet of invoices is uploaded, checked row by row, generated together and printed together', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin/invoices');
    await page.getByRole('tab', { name: /Bulk invoices/ }).click();

    const csv = [
      'Client (code or name),Invoice date,Consignee,Vehicle number,From,To,Goods,Gross weight (kg),Rate (₹),Place of supply (state)',
      'CLT-0092,07-11-2026,Asian Depot,WB 23 C 1199,Kolkata,Nashik,Paint drums,18000,186000,West Bengal',
      'CLT-0092,07-11-2026,Pune Depot,WB 23 C 2200,Kolkata,Pune,Paint drums,"16,500",172000,West Bengal',
      'CLT-0092,07-11-2026,,,Kolkata,Pune,Paint drums,16500,172000,West Bengal',
    ].join('\r\n');
    await page.getByTestId('bulk-file').setInputFiles({ name: 'november.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(main(page).getByText('3 rows read from november.csv.')).toBeVisible();

    // Row 3 has no consignee or truck — the batch waits until it does.
    await expect(page.getByTestId('bulk-summary')).toContainText('2 of 3 ready');
    await expect(page.getByTestId('bulk-grid')).toContainText('Consignee is missing');
    await expect(page.getByRole('button', { name: /Generate 3 invoices/ })).toBeDisabled();
    await page.getByLabel('Remove row 3').click();
    await expect(page.getByTestId('bulk-summary')).toContainText('2 of 2 ready · ₹3,58,000');

    await page.getByRole('button', { name: /Generate 2 invoices/ }).click();
    const made = page.getByTestId('bulk-made');
    await expect(made.locator('tbody tr')).toHaveCount(2);
    await expect(made).toContainText('NEX-INV-');

    await openInPage(page, main(page).getByRole('link', { name: /Print all/ }));
    await expect(page.locator('[data-tax-invoice]')).toHaveCount(2);
    await expect(page.locator('[data-tax-invoice]').nth(1)).toContainText('16,500 kg');
  });

  test('the template downloads with every column the builder reads', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin/invoices');
    await page.getByRole('tab', { name: /Bulk invoices/ }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download the template/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('manual-invoices-template.csv');
  });

  test('only an administrator builds by hand', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices');
    await expect(main(page).getByRole('link', { name: /Manual invoice/ })).toHaveCount(0);
  });
});
