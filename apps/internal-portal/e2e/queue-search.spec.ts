import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { setRole } from './helpers';

/**
 * The search bar on the payment and proof lists — the same one `/orders`
 * uses (see orders-search.spec.ts). Boxes are located by `data-filter`, the
 * field's key, so wording changes do not redden this file. Seed data is the
 * one payments.spec.ts and pod.spec.ts describe.
 */

const filter = (page: Page, key: string) => page.locator(`[data-filter="${key}"]`);
const rows = (page: Page) => page.locator('table.table tbody tr');

test.describe('advance payments', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/advance');
    await expect(rows(page)).toHaveCount(1);
  });

  test('transporter and state narrow the queue, and a miss says so', async ({ page }) => {
    await filter(page, 'vendor').fill('rathod');
    await expect(rows(page)).toHaveCount(1);

    await filter(page, 'state').selectOption('ready');
    await expect(page.getByText('No advance matches this search')).toBeVisible();

    await page.getByRole('button', { name: /^Clear/ }).click();
    await expect(rows(page)).toHaveCount(1);
  });
});

test.describe('transporter bills', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/bills');
    await expect(rows(page)).toHaveCount(2);
  });

  test('bill number and variance narrow the list', async ({ page }) => {
    await filter(page, 'ref').fill('BL/26/1180');
    await expect(rows(page)).toHaveCount(1);
    await filter(page, 'ref').fill('');

    await filter(page, 'variance').selectOption('yes');
    await expect(rows(page)).toHaveCount(1);
    await filter(page, 'variance').selectOption('no');
    await expect(rows(page)).toHaveCount(1);
  });

  test('a status nobody has reached shows the empty state', async ({ page }) => {
    await filter(page, 'status').selectOption('ACCEPTED');
    await expect(page.getByText('No bill matches this search')).toBeVisible();
  });

  test('export carries the filtered bills', async ({ page }) => {
    await filter(page, 'ref').fill('BL/26/1180');
    await expect(rows(page)).toHaveCount(1);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export to spreadsheet/ }).click();
    const file = await download;

    expect(file.suggestedFilename()).toMatch(/^transporter-bills-\d{4}-\d{2}-\d{2}\.csv$/);
    const lines = readFileSync((await file.path())!, 'utf-8').replace(/^﻿/, '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('BL/26/1180');
  });
});

test.describe('collect POD', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/receiving');
    await expect(rows(page)).toHaveCount(4);
  });

  test('trip number and transporter narrow the register', async ({ page }) => {
    await filter(page, 'ref').fill('120869');
    await expect(rows(page)).toHaveCount(1);
    await filter(page, 'ref').fill('');

    await filter(page, 'vendor').fill('anand');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('120855');
  });
});

test.describe('check POD status', () => {
  test('client and route boxes join the existing branch and ageing ones', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/pending');
    await expect(rows(page)).toHaveCount(3);

    await filter(page, 'clientName').fill('berger');
    await expect(rows(page)).toHaveCount(2);
    await filter(page, 'from').fill('nashik');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('120881');
  });
});

test.describe('final payments', () => {
  test('ready and held split the queue, and a transporter narrows it', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/balance');
    await expect(rows(page)).toHaveCount(4);

    await filter(page, 'state').selectOption('ready');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText('120855');

    await filter(page, 'state').selectOption('held');
    await expect(rows(page)).toHaveCount(3);

    await filter(page, 'vendor').fill('rathod');
    await expect(rows(page)).toHaveCount(1);
    // The number only: the "TRP-" prefix is on its way out of the app.
    await expect(rows(page).first()).toContainText('120881');
  });
});
