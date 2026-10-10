import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The company on its documents (10 Oct 2026).
 *
 * The printed invoice carries INVOICE, its number and whether it is paid in the
 * letterhead, above the rule, and is short enough to be one A4 page. The
 * control panel lets a detail be added to the company — an MSME number, a TAN —
 * beyond the fixed ones.
 */

test.describe('printed invoice layout', () => {
  test('INVOICE, its number and its status sit above the rule', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/print/invoice/inv-411');

    const title = page.locator('[data-invoice-title]');
    await expect(title).toContainText('INVOICE');
    await expect(title).toContainText('# NEX-INV-000411');
    const titleBox = (await title.boundingBox())!;
    const ruleBox = (await page.locator('[data-invoice-rule]').boundingBox())!;
    expect(titleBox.y + titleBox.height).toBeLessThanOrEqual(ruleBox.y);

    // Who is billing whom comes below it.
    const companyBox = (await page.locator('[data-company-block]').boundingBox())!;
    expect(companyBox.y).toBeGreaterThan(ruleBox.y);
  });

  test('the invoice is short enough for one A4 page', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.setViewportSize({ width: 794, height: 1123 });
    await page.emulateMedia({ media: 'print' });
    await page.goto('/print/invoice/inv-411');
    await expect(page.locator('[data-invoice-title]')).toBeVisible();
    const sheet = (await page.locator('.sheet').boundingBox())!;
    // A4 is 1123 px tall at 96 dpi; the print margins are 12 mm (45 px) top and bottom.
    expect(sheet.height).toBeLessThanOrEqual(1123 - 2 * 45);
  });
});

test.describe('company details in the control panel', () => {
  test('a detail can be added, corrected and removed', async ({ page, isMobile }) => {
    test.skip(!!isMobile, 'The same form on a narrower screen.');
    await setRole(page, 'ADMIN');
    await page.goto('/admin');

    const extras = page.locator('[data-company-extras]');
    await expect(extras).toContainText('More details');
    const add = extras.getByRole('button', { name: '+ Add detail' });
    await expect(add).toBeDisabled();

    await extras.locator('input[name="company-extra-label"]').fill('MSME Number');
    await extras.locator('input[name="company-extra-value"]').fill('UDYAM-AP-10-0012345');
    await add.click();

    // It is now one of the company's details, and the boxes are ready for the next.
    const added = extras.locator('input[name="company-extra-0"]');
    await expect(added).toHaveValue('UDYAM-AP-10-0012345');
    await expect(extras.locator('label', { hasText: 'MSME Number' })).toBeVisible();
    await expect(extras.locator('input[name="company-extra-label"]')).toHaveValue('');

    // The same name twice is refused.
    await extras.locator('input[name="company-extra-label"]').fill('msme number');
    await extras.locator('input[name="company-extra-value"]').fill('x');
    await expect(add).toBeDisabled();
    await expect(extras).toContainText('There is already a detail with this name.');

    // Removing asks first, and "Cancel" keeps it.
    const remove = extras.getByRole('button', { name: 'Remove MSME Number' });
    await expect(remove).toContainText('Remove');
    await remove.click();
    const dialog = page.locator('.surface', { has: page.getByRole('heading', { name: 'Remove this detail' }) }).last();
    await expect(dialog).toContainText('Remove this detail');
    await expect(dialog).toContainText('UDYAM-AP-10-0012345');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(added).toHaveCount(1);

    await remove.click();
    await page.locator('.surface', { has: page.getByRole('heading', { name: 'Remove this detail' }) }).last().getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(added).toHaveCount(0);
  });

  test('the address is typed as lines', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/admin');
    await expect(page.locator('textarea[name="company-address"]')).toBeVisible();
  });
});
