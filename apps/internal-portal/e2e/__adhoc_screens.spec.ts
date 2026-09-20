import { test } from '@playwright/test';
import { setRole } from './helpers';
import path from 'path';

const outDir = path.join(__dirname, '..', '..', '..', '..', '..', '..', 'AppData', 'Local', 'Temp', 'claude', 'c--Users-saivi-Documents-nexraah-app', '85d07f58-2b8e-46d7-a114-db6838eecdf0', 'scratchpad', 'internal-shots');

const OPS_PAGES = [
  '/today',
  '/home',
  '/orders',
  '/indents',
  '/indents/i-4471',
  '/trips',
  '/trips/t-120881',
  '/trips/t-120881/documents',
  '/trips/t-120881/charges',
  '/trips/t-120881/lr',
  '/pod/pending',
  '/pod/receiving',
  '/vendors',
  '/vendors/v-1',
  '/clients',
  '/rfq',
  '/telematics',
  '/search',
  '/vendors/market-gap',
  '/vendors/leads',
  '/vendors/issues',
];

test('capture OPS screens', async ({ page }) => {
  await setRole(page, 'OPS');
  for (const p of OPS_PAGES) {
    try {
      await page.goto(p, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(300);
      const name = p.replace(/\//g, '_') || 'root';
      await page.screenshot({ path: path.join(outDir, `ops${name}.png`), fullPage: false });
    } catch (e) {
      console.log('FAILED', p, (e as Error).message);
    }
  }
});

test('capture FINANCE and COMPLIANCE screens', async ({ page }) => {
  await setRole(page, 'FINANCE');
  for (const p of ['/payments/advance', '/payments/balance', '/payments/bills', '/invoices', '/receivables', '/pnl']) {
    try {
      await page.goto(p, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(300);
      const name = p.replace(/\//g, '_');
      await page.screenshot({ path: path.join(outDir, `finance${name}.png`), fullPage: false });
    } catch (e) {
      console.log('FAILED', p, (e as Error).message);
    }
  }
});

test('capture ADMIN screens', async ({ page }) => {
  await setRole(page, 'ADMIN');
  for (const p of ['/admin', '/admin/roles', '/admin/branches', '/admin/import', '/admin/approvals', '/records', '/tickets']) {
    try {
      await page.goto(p, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(300);
      const name = p.replace(/\//g, '_');
      await page.screenshot({ path: path.join(outDir, `admin${name}.png`), fullPage: false });
    } catch (e) {
      console.log('FAILED', p, (e as Error).message);
    }
  }
});
