import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * A client's papers can be uploaded (10 Oct 2026).
 *
 * Client verification used to offer only "Mark received" — a note that the
 * paper had come in, with no file behind it. Each paper now has "Upload file";
 * once a file is on it, it can be viewed and replaced.
 */

const scan = { name: 'gst-certificate.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% a small scan\n') };

test.describe('uploading a client’s papers', () => {
  test('Compliance uploads a paper, then can view and replace it', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/clients/onboarding');
    await page.getByRole('button', { name: 'Open file' }).first().click();

    const upload = page.getByRole('button', { name: 'Upload file' }).first();
    await expect(upload).toBeVisible();
    const before = await page.getByRole('button', { name: 'Upload file' }).count();
    await expect(page.getByRole('button', { name: /View file/ })).toHaveCount(0);

    const chooser = page.waitForEvent('filechooser');
    await upload.click();
    await (await chooser).setFiles(scan);

    // The paper now carries its file: it can be opened, and sent again.
    await expect(page.getByRole('button', { name: /View file/ })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Replace file' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Upload file' })).toHaveCount(before - 1);
  });

  test('a file over 10 MB is turned away before it is sent', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/clients/onboarding');
    await page.getByRole('button', { name: 'Open file' }).first().click();

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload file' }).first().click();
    await (await chooser).setFiles({ name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });

    await expect(page.getByText('That file is larger than 10 MB — send a smaller scan or photo.')).toBeVisible();
    await expect(page.getByRole('button', { name: /View file/ })).toHaveCount(0);
  });
});
