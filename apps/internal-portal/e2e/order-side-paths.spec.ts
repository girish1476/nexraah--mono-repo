import { Locator, Page, test, expect } from '@playwright/test';
import { DEMO_PASSWORD } from '../src/mocks/db';

/**
 * The paths beside the main order cycle, from a clean console, signing in as
 * each desk:
 *
 *   - a per-tonne (PMT) lane: proposed by BD, refused when proposed twice,
 *     signed off by Compliance, then a load priced at rate × weight;
 *   - Leadership deleting a lane proposed by mistake;
 *   - a spot load with the client's confirmation screenshot;
 *   - a document rejected by Compliance and uploaded again;
 *   - the proof of delivery as an H-POD (courier hard copy) rather than an E-POD.
 */

const PEOPLE = {
  OPS: 'anil@nexraah.in',
  COMPLIANCE: 'meera@nexraah.in',
  FINANCE: 'rakesh@nexraah.in',
  BD: 'neha@nexraah.in',
  LEADERSHIP: 'vikram@nexraah.in',
} as const;

async function signInAs(page: Page, who: keyof typeof PEOPLE) {
  await page.goto('/signin');
  await page.getByRole('textbox', { name: 'Email' }).fill(PEOPLE[who]);
  await page.locator('input[name="password"]').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /^Sign in/ }).click();
  await expect(page).not.toHaveURL(/\/signin$/, { timeout: 30_000 });
}

async function switchTo(page: Page, who: keyof typeof PEOPLE) {
  if (await page.getByRole('button', { name: 'Sign out' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/signin$/, { timeout: 30_000 });
  }
  await signInAs(page, who);
}

const field = (scope: Page | Locator, label: string) =>
  scope.locator('div.field').filter({ hasText: label }).locator('input, select, textarea').first();
const dialog = (page: Page, title: string | RegExp) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: title }) });
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

const photo = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
) };
const pdf = { name: 'vehicle.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 vehicle papers') };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

test.describe('beside the main cycle', () => {
  test.setTimeout(300_000);
  let page: Page;
  let orderUrl = '';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 950 });
  });
  test.afterAll(async () => page.close());

  const addLane = async (to: string, basis: 'FTL' | 'PMT', rate: string) => {
    await page.goto('/clients/rate-changes');
    const client = page.locator('select').first();
    const label = (await client.locator('option', { hasText: 'Berger Paints' }).first().textContent())!.trim();
    await client.selectOption({ label });
    await page.getByRole('button', { name: /Add a lane/ }).first().click();
    const lane = dialog(page, /^Add a lane/);
    await field(lane, 'Rate basis').selectOption(basis);
    await lane.getByPlaceholder('e.g. 32 ft MXL').fill('32 ft MXL');
    await field(lane, 'Transit days').fill('3');
    await field(lane, 'From location').fill('Kolkata');
    await field(lane, 'To location').fill(to);
    await field(lane, basis === 'PMT' ? 'Lane rate per tonne (₹)' : 'Lane rate per truck (₹)').fill(rate);
    await field(lane, 'Approval mail subject').fill(`RE: Berger Kolkata–${to} rate approved`);
    await field(lane, 'Where this rate was agreed').fill('Client mail of 30 September agreeing the rate');
    await lane.getByRole('button', { name: 'Send for sign-off' }).click();
  };

  test('1 · BD proposes a per-tonne lane; the same lane again is refused', async () => {
    await signInAs(page, 'BD');
    await addLane('Pune', 'PMT', '2450');
    await expect(page.getByText(/Sent for sign-off/)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Pune' })).toContainText('₹2,450 / tonne');
    await addLane('Pune', 'PMT', '2450');
    await expect(page.getByText(/already waiting for approval/)).toBeVisible();
    await page.keyboard.press('Escape');
    await addLane('Surat', 'FTL', '61000');
    await expect(page.getByText(/Sent for sign-off/).first()).toBeVisible();
  });

  test('2 · Leadership deletes the lane proposed by mistake', async () => {
    await switchTo(page, 'LEADERSHIP');
    await page.goto('/clients/rate-changes');
    const client = page.locator('select').first();
    await client.selectOption({ label: (await client.locator('option', { hasText: 'Berger Paints' }).first().textContent())!.trim() });
    const surat = page.getByRole('row').filter({ hasText: 'Surat' });
    await surat.getByRole('button', { name: /Delete/ }).click();
    await field(page, 'Why is it being deleted?').fill('Proposed by mistake — no Surat business');
    await page.getByRole('button', { name: 'Delete rate' }).click();
    await expect(page.getByText(/^Deleted · /)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Surat' })).toHaveCount(0);
  });

  test('3 · Compliance signs off the per-tonne lane', async () => {
    await switchTo(page, 'COMPLIANCE');
    await page.goto('/admin/approvals');
    const card = page.locator('.surface, tr, li').filter({ hasText: 'RE: Berger Kolkata–Pune rate approved' }).last();
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/Approved/).first()).toBeVisible();
  });

  test('4 · OPS raises a load on it — freight is rate × weight', async () => {
    await switchTo(page, 'OPS');
    await page.goto('/indents/new');
    await page.locator('select[name="clientId"]').selectOption({ label: 'Berger Paints · CONTRACT' });
    const lane = field(page, 'Agreed lane');
    const pune = (await lane.locator('option', { hasText: 'Kolkata → Pune' }).first().getAttribute('value'))!;
    await lane.selectOption(pune);
    await page.locator('input[name="weightTn"]').fill('20');
    await expect(page.locator('input[name="sellRupees"]')).toHaveValue('49000');
    await page.locator('input[name="material"]').fill('Emulsion paint');
    await page.locator('input[name="pickupDate"]').fill(day(2));
    await page.getByRole('button', { name: 'Raise indent' }).click();
    await expect(page).toHaveURL(/\/indents\/i-\d+$/);
    orderUrl = `/orders/${page.url().split('/').pop()}`;
  });

  test('5 · OPS raises a spot load with the client’s confirmation screenshot', async () => {
    await page.goto('/indents/new');
    await page.locator('select[name="clientId"]').selectOption({ label: 'Berger Paints · CONTRACT' });
    await page.getByRole('button', { name: 'Book it as spot' }).first().click();
    await page.locator('input[name="fromCity"]').fill('Kolkata');
    await page.locator('input[name="toCity"]').fill('Raipur');
    await page.locator('input[name="truckType"]').fill('32 ft SXL');
    await page.locator('input[name="material"]').fill('Primer');
    await page.locator('input[name="weightTn"]').fill('15');
    await page.locator('input[name="pickupDate"]').fill(day(3));
    await page.locator('input[name="sourcingRupees"]').fill('40000');
    await page.locator('input[name="sellRupees"]').fill('46000');
    await expect(page.getByRole('button', { name: 'Raise indent' })).toBeDisabled();
    await page.locator('input[type="file"]').first().setInputFiles(photo);
    await page.getByRole('button', { name: /Attach/ }).click();
    await expect(page.getByText('Client confirmation attached')).toBeVisible();
    await page.getByRole('button', { name: 'Raise indent' }).click();
    await expect(page).toHaveURL(/\/indents\/i-\d+$/);
  });

  test('6 · the PMT load: award, allocate, reach and load; a rejected document is uploaded again', async () => {
    await page.goto(orderUrl);
    await page.getByRole('link', { name: 'Enter a quote' }).click();
    await page.getByRole('button', { name: 'Enter a quote' }).click();
    const q = dialog(page, 'Enter a quote');
    await field(q, 'Transporter').selectOption({ label: 'Rathod Roadlines · Nashik' });
    await field(q, 'Quote (₹)').fill('43000');
    await q.getByRole('button', { name: 'Enter quote' }).click();
    await expect(page.getByText('Quote entered')).toBeVisible();
    await page.goto(orderUrl);
    await page.getByRole('button', { name: /^(Award|Request approval)$/ }).first().click();
    await page.getByRole('button', { name: 'Allocate vehicle' }).first().click();
    const a = dialog(page, 'Allocate vehicle');
    await field(a, 'Vehicle number').fill('MH 15 GT 4482');
    await field(a, 'Driver mobile number').fill('9876543210');
    await a.getByRole('button', { name: 'Allocate vehicle' }).last().click();
    await expect(page.getByText('Vehicle allocated').first()).toBeVisible();
    // Both marks straight from the Details tab's Next step.
    await page.getByRole('button', { name: /Reached the loading point/ }).click();
    await expect(page.getByText('Marked · reached the loading point')).toBeVisible();
    await page.getByRole('button', { name: /📦 Loaded/ }).click();
    await expect(page.getByText(/Marked loaded/)).toBeVisible();

    await tab(page, /Documents/).click();
    const upload = async (card: string, file: typeof photo, fill: Record<string, string>) => {
      await page.locator(`[data-doc="${card}"]`).getByRole('button', { name: /^(Upload|Replace|Upload again)/ }).click();
      const d = page.locator('.surface').filter({ has: page.locator('input[type="file"]') }).last();
      await d.locator('input[type="file"]').setInputFiles(file);
      for (const [label, value] of Object.entries(fill)) await field(d, label).fill(value);
      await d.getByRole('button', { name: 'Save' }).click();
      await expect(page.locator(`[data-doc="${card}"]`)).toContainText('Waiting for check');
    };
    await upload('invoice', photo, { 'Invoice number': 'WRONG-NO', 'Invoice value (₹)': '49000' });
    await upload('eway', photo, { 'Vehicle number on it': 'MH 15 GT 4482', 'Valid till': day(10) });
    await upload('vehicle', pdf, { 'RC number': 'MH15GT4482', 'Permit valid till': day(300), 'Insurance (IC) valid till': day(300), 'Fitness valid till': day(300) });
    await upload('dl', photo, { 'Licence number': 'MH1520190012345', 'Valid till': day(300) });
    await upload('loading-slip', photo, {});

    await switchTo(page, 'COMPLIANCE');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    await page.locator('[data-doc="invoice"]').getByRole('button', { name: 'Reject' }).click();
    await field(page, 'Reason').fill('Invoice number does not match the paper');
    await page.getByRole('button', { name: 'Reject', exact: true }).last().click();
    await expect(page.locator('[data-doc="invoice"]')).toContainText('Rejected');

    await switchTo(page, 'OPS');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    await upload('invoice', photo, { 'Invoice number': 'BRG/26/0500', 'Invoice value (₹)': '49000' });
  });

  test('7 · verified, advance paid, on the road, unloaded, and the proof comes in as an H-POD', async () => {
    await switchTo(page, 'COMPLIANCE');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    for (const card of ['invoice', 'eway', 'vehicle', 'dl', 'loading-slip']) {
      await page.locator(`[data-doc="${card}"]`).getByRole('button', { name: 'Verify' }).click();
      await expect(page.locator(`[data-doc="${card}"]`)).toContainText('Verified');
    }

    await switchTo(page, 'FINANCE');
    await page.goto(orderUrl);
    await page.getByRole('button', { name: /^Release/ }).first().click();
    const r = dialog(page, 'Release advance');
    await field(r, 'UTR').fill('UTR700800900');
    await r.getByRole('button', { name: 'Confirm release' }).click();
    await expect(page.getByText(/Advance released/).first()).toBeVisible();

    await switchTo(page, 'OPS');
    await page.goto(orderUrl);
    await expect(page.locator('main').getByText('On the road').first()).toBeVisible();
    await page.getByRole('button', { name: /Reached the unloading point/ }).click();
    await expect(page.getByText('Marked · reached the unloading point')).toBeVisible();
    await page.getByRole('button', { name: /Mark unloaded/ }).click();
    await expect(page.getByText(/Marked unloaded/)).toBeVisible();

    await tab(page, /Documents/).click();
    await page.getByRole('tab', { name: /H-POD/ }).click();
    await field(page, 'Courier docket').fill('DKT-778899');
    await field(page, 'Sent on').fill(day(0));
    await field(page, 'Received on').fill(day(0));
    await page.getByRole('button', { name: /Log the paper copy/ }).click();
    await expect(page.getByText(/logged · the clock has stopped/)).toBeVisible();
    await expect(page.getByText('H-POD — signed hard copy').first()).toBeVisible();
  });
});
