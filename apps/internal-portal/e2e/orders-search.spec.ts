import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setRole } from './helpers';

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
    // The default tab is "Action required"; search across every shipment.
    await page.getByRole('tab', { name: /All shipments/ }).click();
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
    // Seven orders in the fixtures; waited for rather than counted, because the
    // list still shows the "Action required" rows for a moment after the tab click.
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
