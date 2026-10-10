import { test, expect, Page } from '@playwright/test';
import { setRole } from './helpers';

/**
 * A client's papers are uploaded as the client is created (10 Oct 2026).
 *
 * The New client form has a Documents section: one row for each paper
 * Compliance will check. Files chosen there go up against the client the moment
 * it is created, and wait to be checked on Client verification.
 */

const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% a small scan\n') });

const fill = async (page: Page, name: string) => {
  await page.locator('[name="name"]').fill(name);
  await page.locator('[name="billingCity"]').fill('Hosur');
  await page.locator('[name="billingAddress"]').fill('Plot 12, SIPCOT Phase II');
  await page.locator('[name="billingState"]').fill('Tamil Nadu');
  await page.locator('[name="billingPincode"]').fill('635109');
  await page.locator('[name="contact"]').fill('R. Venkat');
  await page.locator('[name="phone"]').fill('9843012345');
  await page.locator('[name="email"]').fill('logistics@docs.example');
  await page.locator('[name="agreementNo"]').fill('DOC/RC/2026-27');
};

test.describe('uploading papers on the New client form', () => {
  test('files chosen on the form go up with the client', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');

    const papers = page.locator('[data-client-papers]');
    await expect(papers.locator('[data-paper]')).toHaveCount(4);
    const row = (kind: string) => papers.locator(`[data-paper="${kind}"]`);

    await row('GST_CERTIFICATE').locator('input[type="file"]').setInputFiles(pdf('gst-certificate.pdf'));
    await row('PAN').locator('input[type="file"]').setInputFiles(pdf('pan-card.pdf'));
    await expect(row('GST_CERTIFICATE')).toContainText('gst-certificate.pdf');
    await expect(row('GST_CERTIFICATE')).toContainText('Change file');
    await expect(row('PAN')).toContainText('pan-card.pdf');

    // A file chosen by mistake is taken off again.
    await row('CREDIT_CHECK').locator('input[type="file"]').setInputFiles(pdf('wrong.pdf'));
    await row('CREDIT_CHECK').getByRole('button', { name: /Remove/ }).click();
    await expect(row('CREDIT_CHECK')).not.toContainText('wrong.pdf');
    await expect(row('CREDIT_CHECK')).toContainText('Upload file');

    await fill(page, 'Docs Auto Components');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText(/Docs Auto Components added with 2 documents$/)).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/c-/);
  });

  test('a client is still created with no papers, and a spot client is not asked for an agreement', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');

    const papers = page.locator('[data-client-papers]');
    await expect(papers.locator('[data-paper="SIGNED_AGREEMENT"]')).toHaveCount(1);
    await page.locator('select[name="engagement"]').selectOption('SPOT');
    await expect(papers.locator('[data-paper="SIGNED_AGREEMENT"]')).toHaveCount(0);
    await expect(papers.locator('[data-paper]')).toHaveCount(3);

    await page.locator('select[name="engagement"]').selectOption('CONTRACT');
    await fill(page, 'No Papers Traders');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText(/No Papers Traders added$/)).toBeVisible();
  });

  test('a file over 10 MB is turned away on the form', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');
    const row = page.locator('[data-paper="PAN"]');
    await row.locator('input[type="file"]').setInputFiles({ name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
    await expect(page.getByText('That file is larger than 10 MB — choose a smaller scan or photo.')).toBeVisible();
    await expect(row).not.toContainText('huge.pdf');
  });
});
