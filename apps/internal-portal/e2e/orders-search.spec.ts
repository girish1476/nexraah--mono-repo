import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { scopedOperations, setRole } from './helpers';

/**
 * `/orders` multi-field search and export — the owner's "All Orders page" note.
 *
 * Fixture trips (see trips.spec.ts): Rathod Roadlines on MH 15 GT 4482 for
 * Berger Paints, Sai Kripa Carriers on MH 12 QR 8841 for Berger Paints,
 * Bhagwati Logistics on MH 04 TT 2019 and Anand Roadways on GJ 12 AT 7745 for
 * Apex Ceramics. Fields are located by `data-filter` — the field's key —
 * so a wording change on a label does not redden the suite.
 */

const filter = (page: import('@playwright/test').Page, key: string) => page.locator(`[data-filter="${key}"]`);
const rows = (page: import('@playwright/test').Page) => page.locator('table.table tbody tr');

test.describe('orders search', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/orders');
    await expect(filter(page, 'vendor')).toBeVisible();
  });

  test('transporter narrows to that transporter’s loads', async ({ page }) => {
    await filter(page, 'vendor').fill('rathod');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Rathod Roadlines');
  });

  test('truck number ignores spaces and dashes', async ({ page }) => {
    await filter(page, 'truck').fill('mh-12-qr-8841');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Sai Kripa Carriers');
  });

  test('a trip number finds its order, and filters combine', async ({ page }) => {
    await filter(page, 'ref').fill('120869');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('Apex Ceramics');

    // Every filled box has to match: Berger Paints never travelled with Bhagwati.
    await filter(page, 'clientName').fill('berger');
    await expect(page.getByText('Nothing matches these filters')).toBeVisible();
  });

  test('Clear empties every box and brings the list back', async ({ page }) => {
    // Seven orders in the fixtures, all listed when nothing is searched.
    const total = 7;
    await expect(rows(page)).toHaveCount(total);
    await filter(page, 'vendor').fill('rathod');
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: /^Clear/ }).click();
    await expect(filter(page, 'vendor')).toHaveValue('');
    await expect(rows(page)).toHaveCount(total);
  });

  test('export downloads what the filters found, as a spreadsheet file', async ({ page }) => {
    await filter(page, 'vendor').fill('rathod');
    await expect(rows(page)).toHaveCount(1);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export to spreadsheet/ }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^orders-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = readFileSync((await file.path())!, 'utf-8');
    const lines = text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toContain('Transporter');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Rathod Roadlines');
  });
});

test.describe('orders — the page itself', () => {
  test('opens straight on the search boxes and every order: no intro, legend or tabs', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/orders');
    await expect(filter(page, 'q')).toBeVisible();
    await expect(rows(page)).toHaveCount(7);
    await expect(page.getByRole('tab')).toHaveCount(0);
    await expect(page.getByText('What every load goes through')).toHaveCount(0);
    await expect(page.getByText('One row per load, from the moment')).toHaveCount(0);
  });

  test('a branch desk sees its own orders, and a search with no match says so', async ({ page }) => {
    await setRole(page, scopedOperations());
    await page.goto('/orders');
    await expect(rows(page)).toHaveCount(1);
    await filter(page, 'vendor').fill('no such transporter');
    await expect(page.locator('main').getByText('Nothing matches these filters')).toBeVisible();
  });
});

test.describe('orders — quick views under the search', () => {
  test('All orders, Vehicle assignment, In transit, Delivered and Indents are one click away', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/orders');
    const views = page.getByTestId('order-quick-views');
    const all = views.getByRole('button', { name: /All orders · \d+/ });
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    const everything = await rows(page).count();

    // Each view narrows the list to its steps, and its count is what it lists.
    for (const name of ['Vehicle assignment', 'In transit', 'Delivered']) {
      const button = views.getByRole('button', { name: new RegExp(name) });
      const count = Number((await button.innerText()).split('·').pop()!.replace(/\D/g, ''));
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      if (count > 0) await expect(rows(page)).toHaveCount(count);
      else await expect(page.locator('main')).toContainText(`Nothing in ${name} right now`);
    }

    await all.click();
    await expect(rows(page)).toHaveCount(everything);

    await views.getByRole('link', { name: /Indents/ }).click();
    await expect(page).toHaveURL(/\/indents$/);
  });
});
