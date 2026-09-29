import { Locator, Page, test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The courier docket is the proof the delivery's paper was sent. A transporter
 * records one when they attach their proof; whoever tracks the POD can add it
 * when they have not. Once a docket is on record the delivery drops out of the
 * hard-copy follow-up list.
 *
 * Fixture: 120881 (delivered, no docket) and 120874 (the transporter
 * has attached its proof, docket DKT-778812).
 */

const row = (page: Page, text: string) => page.locator('table.table tbody tr').filter({ hasText: text });

function fieldControl(scope: Page | Locator, label: string) {
  return scope.locator('div.field').filter({ hasText: label }).locator('input');
}

test.describe('pod courier docket', () => {
  test('the plain chase list shows each docket, and one can be added where it is missing', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/pod/pending');

    await expect(row(page, '120874')).toContainText('DKT-778812');
    await expect(row(page, '120874').getByRole('button', { name: 'Add docket' })).toHaveCount(0);

    await row(page, '120881').getByRole('button', { name: 'Add docket' }).click();
    const dialog = page.locator('.surface').filter({ has: page.getByRole('heading', { name: 'Add courier docket' }) });
    await fieldControl(dialog, 'Courier docket number').fill('DKT-445566');
    await dialog.getByRole('button', { name: 'Record docket' }).click();

    await expect(page.getByText(/Docket DKT-445566 recorded/)).toBeVisible();
    await expect(row(page, '120881')).toContainText('DKT-445566');
    await expect(row(page, '120881').getByRole('button', { name: 'Add docket' })).toHaveCount(0);
  });

  test('a delivery with a docket is not on the hard-copy follow-up list', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/pod/pending?copy=pending');

    await expect(row(page, '120881')).toHaveCount(1);
    // The transporter already attached its proof with a docket.
    await expect(row(page, '120874')).toHaveCount(0);
  });
});
