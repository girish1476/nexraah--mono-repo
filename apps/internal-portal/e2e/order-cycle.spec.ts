import { Locator, Page, test, expect } from '@playwright/test';
import { DEMO_CODE } from '../src/mocks/db';

/**
 * The order cycle the operations team works to, driven only from the order
 * page — its Next step, Tracking and Documents tabs — signing in as each desk:
 *
 *   OPS         raise the load (with addresses), enter and award the quote,
 *               allocate the vehicle, track it to the loading point, mark it
 *               loaded, upload the advance documents (vehicle papers as one PDF)
 *   COMPLIANCE  verify each document on its card
 *   FINANCE     release the advance — the truck goes on the road by itself —
 *               and bill the client while it is in transit
 *   OPS         track it, mark it at the unloading point and unloaded, upload the E-POD
 *   COMPLIANCE  verify the proof;  LEADERSHIP approve it
 *   FINANCE     release the balance
 *
 * Each step must find its button where a person would look for it; a step that
 * cannot is a blocker in the flow.
 */

const PEOPLE = {
  OPS: 'anil@nexraah.in',
  COMPLIANCE: 'meera@nexraah.in',
  FINANCE: 'rakesh@nexraah.in',
  LEADERSHIP: 'vikram@nexraah.in',
} as const;

async function signInAs(page: Page, who: keyof typeof PEOPLE) {
  await page.goto('/signin');
  await page.getByRole('textbox', { name: 'Email' }).fill(PEOPLE[who]);
  await page.getByRole('button', { name: /^Send me a code/ }).click();
  // Filling the first box with the whole code is what a paste or a phone's
  // one-time-code autofill does; the form signs in on the last digit.
  await page.getByLabel('Digit 1').fill(DEMO_CODE);
  await expect(page).not.toHaveURL(/\/signin$/, { timeout: 30_000 });
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/signin$/, { timeout: 30_000 });
}

const field = (scope: Page | Locator, label: string) =>
  scope.locator('div.field').filter({ hasText: label }).locator('input, select, textarea').first();

const dialog = (page: Page, title: string | RegExp) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: title }) });

/** Details typed off each document — by Compliance, as they verify it. */
const details: Record<string, Record<string, string>> = {};

async function verifyCard(page: Page, card: string) {
  await page.locator(`[data-doc="${card}"]`).getByRole('button', { name: 'Verify' }).click();
  const d = page.locator('.surface').filter({ has: page.getByRole('heading', { name: /^Verify · / }) }).last();
  for (const [label, value] of Object.entries(details[card] ?? {})) await field(d, label).fill(value);
  await d.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator(`[data-doc="${card}"]`)).toContainText('Verified');
}

const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

const photo = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
) };
const pdf = { name: 'vehicle.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 vehicle papers') };

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

test.describe('the order cycle, from the order page', () => {
  test.setTimeout(300_000);

  let page: Page;
  let orderUrl = '';
  const shot = async (name: string) => {
    const dir = process.env.CYCLE_SHOTS;
    if (dir) await page.screenshot({ path: `${dir}/${name}.png`, fullPage: true });
  };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 950 });
  });
  test.afterAll(async () => {
    await page.close();
  });

  test('1 · OPS raises the load from the agreed lane, with addresses', async () => {
    await signInAs(page, 'OPS');
    await page.goto('/indents/new');
    await page.locator('select[name="clientId"]').selectOption({ label: 'Berger Paints · CONTRACT' });
    const lane = field(page, 'Agreed lane');
    await expect(lane.locator('option', { hasText: 'Kolkata → Nashik' })).toHaveCount(1);
    await lane.selectOption({ index: 1 });
    await page.locator('input[name="material"]').fill('Decorative paints');
    await page.locator('input[name="weightTn"]').fill('18');
    await page.locator('input[name="pickupDate"]').fill(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));
    await page.locator('textarea[name="pickupAddress"]').fill('Berger Paints, Howrah plant, Gate 2');
    await page.locator('textarea[name="dropAddress"]').fill('Berger depot, MIDC Ambad, Nashik');
    await page.getByRole('button', { name: 'Raise indent' }).click();
    await expect(page).toHaveURL(/\/indents\/i-\d+$/);
    orderUrl = `/orders/${page.url().split('/').pop()}`;
    await shot('01-raised');
  });

  test('2 · OPS enters the quote and awards it from the order’s Next step', async () => {
    await page.goto(orderUrl);
    await page.getByRole('link', { name: 'Enter a quote' }).click();
    await page.getByRole('button', { name: 'Enter a quote' }).click();
    const q = dialog(page, 'Enter a quote');
    await field(q, 'Transporter').selectOption({ label: 'Rathod Roadlines · Nashik' });
    await field(q, 'Quote (₹)').fill('57000');
    await q.getByRole('button', { name: 'Enter quote' }).click();
    await expect(page.getByText('Quote entered')).toBeVisible();
    await page.goto(orderUrl);
    await page.getByRole('button', { name: /^(Award|Request approval)$/ }).first().click();
    await expect(page.getByText(/Awarded to .* allocate the vehicle next/)).toBeVisible();
    await shot('02-awarded');
  });

  test('3 · OPS allocates the vehicle from the Next step', async () => {
    await page.getByRole('button', { name: 'Allocate vehicle' }).first().click();
    const a = dialog(page, 'Allocate vehicle');
    await field(a, 'Vehicle number').fill('MH 15 GT 4482');
    await field(a, 'Driver mobile number').fill('9876543210');
    await a.getByRole('button', { name: 'Allocate vehicle' }).last().click();
    await expect(page.getByText('Where the truck is · MH 15 GT 4482')).toBeVisible();
    await shot('03-allocated');
  });

  test('4 · Tracking: on the way, reached the loading point, loaded', async () => {
    await tab(page, /Tracking/).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'On the way to the loading point' })).toHaveAttribute('aria-current', 'step');
    await field(page, 'Location').fill('Kona Expressway');
    await page.getByRole('button', { name: 'Add update' }).click();
    await expect(page.getByText('Tracking updated')).toBeVisible();
    // Documents cannot be uploaded before loading.
    await tab(page, /Documents/).click();
    await expect(page.getByText('The advance documents are uploaded once the truck is loaded')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Upload (photo|PDF)$/ })).toHaveCount(0);
    await tab(page, /Tracking/).click();
    await page.getByRole('button', { name: /Reached the loading point/ }).click();
    await expect(page.getByText('Marked · reached the loading point')).toBeVisible();
    await page.getByRole('button', { name: /📦 Loaded/ }).click();
    await expect(page.getByText(/Marked loaded/)).toBeVisible();
    await shot('04-loaded');
  });

  test('5 · Documents: the advance documents, each with its details', async () => {
    await tab(page, /Documents/).click();
    // The uploader attaches the file only; the details on it are typed by the
    // verification team when they verify it (see `verifyCard`).
    const upload = async (card: string, file: typeof photo, fill: Record<string, string>) => {
      details[card] = fill;
      await page.locator(`[data-doc="${card}"]`).getByRole('button', { name: /^Upload/ }).click();
      const d = page.locator('.surface').filter({ has: page.locator('input[type="file"]') }).last();
      await d.locator('input[type="file"]').setInputFiles(file);
      await d.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(page.locator(`[data-doc="${card}"]`)).toContainText('Waiting for check');
    };
    const inTenDays = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    await upload('invoice', photo, { 'Invoice number': 'BRG/26/0412', 'Invoice value (₹)': '64200' });
    await upload('eway', photo, { 'E-way bill number': '1812 3456 7890', 'Vehicle number on it': 'MH 15 GT 4482', 'Valid till': inTenDays });
    await upload('vehicle', pdf, {
      'RC number': 'MH15GT4482',
      'Permit valid till': nextYear,
      'Insurance (IC) valid till': nextYear,
      'Fitness valid till': nextYear,
    });
    await upload('dl', photo, { 'Licence number': 'MH1520190012345', 'Valid till': nextYear });
    await upload('loading-slip', photo, { 'Packages loaded': '420', 'Weight loaded (MT)': '18' });
    // This client does not need a weighment slip: the card is closed, not left open.
    await expect(page.locator('[data-doc="weighment"]')).toContainText('Not needed');
    // The loading slip stands in for the LR; an E-LR is generated from it only if wanted.
    await page.locator('[data-doc="loading-slip"]').getByRole('button', { name: /Generate E-LR/ }).click();
    await expect(page.getByText('E-LR (lorry receipt)')).toBeVisible();
    await page.locator('#order-elr').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByText('E-LR (lorry receipt)')).toHaveCount(0);
    await shot('05-documents');
  });

  test('6 · COMPLIANCE verifies each document on its card', async () => {
    await signOut(page);
    await signInAs(page, 'COMPLIANCE');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    for (const card of ['invoice', 'eway', 'vehicle', 'dl', 'loading-slip']) {
      await verifyCard(page, card);
    }
    // The details Compliance typed show on the card.
    await expect(page.locator('[data-doc="vehicle"]')).toContainText('MH15GT4482');
    await tab(page, /Details/).click();
    await expect(page.getByText('📎 Advance documents', { exact: true })).toBeVisible();
    await shot('06-verified');
  });

  test('7 · FINANCE releases the advance — the order moves to the road by itself', async () => {
    await signOut(page);
    await signInAs(page, 'FINANCE');
    await page.goto(orderUrl);
    await page.getByRole('button', { name: /^Release/ }).first().click();
    const r = dialog(page, 'Release advance');
    await field(r, 'UTR').fill('UTR100200300');
    await r.getByRole('button', { name: 'Confirm release' }).click();
    await expect(page.getByText(/Advance released/).first()).toBeVisible();
    await page.reload();
    await expect(page.locator('main').getByText('On the road').first()).toBeVisible();
    await tab(page, /Tracking/).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'On the road' })).toHaveAttribute('aria-current', 'step');
    // In transit, the order offers the client invoice straight from its Next step.
    await tab(page, /Details/).click();
    await expect(page.getByRole('link', { name: /Raise the client invoice/ })).toBeVisible();
    // Details names who uploaded the advance documents and who verified them.
    await expect(page.getByText('Advance documents uploaded by')).toBeVisible();
    await expect(page.getByText('Advance documents verified by')).toBeVisible();
    await shot('07-on-the-road');
  });

  test('8 · FINANCE bills the client while the truck is in transit', async () => {
    await page.goto('/invoices');
    const ready = page.locator('table.table tbody tr').filter({ hasText: 'Berger Paints' }).filter({ hasText: 'In transit' }).first();
    await ready.getByRole('link', { name: 'Raise invoice' }).click();
    await expect(page).toHaveURL(/\/invoices\/new/);
    await page.getByRole('button', { name: 'Generate invoice' }).click();
    await expect(page.getByText(/NEX-INV-\d+ issued/)).toBeVisible();
    await shot('08-invoiced');
  });

  test('9 · OPS tracks it to the unloading point and marks it unloaded', async () => {
    await signOut(page);
    await signInAs(page, 'OPS');
    await page.goto(orderUrl);
    await tab(page, /Tracking/).click();
    await field(page, 'Status').selectOption('BREAKDOWN');
    await field(page, 'Location').fill('Nagpur bypass');
    await field(page, 'Latitude').fill('21.1458');
    await field(page, 'Longitude').fill('79.0882');
    await page.getByRole('button', { name: 'Add update' }).click();
    await expect(page.getByText('Tracking updated')).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Breakdown');
    // The breakdown runs past the e-way bill: it is extended from the Tracking tab.
    const inTwelveDays = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
    await field(page, 'Extend validity till').fill(inTwelveDays);
    await field(page, 'Why it was extended').fill('Breakdown near Nagpur');
    await page.getByRole('button', { name: /Extend e-way bill/ }).click();
    await expect(page.getByText('E-way bill extended').first()).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Breakdown near Nagpur');
    await page.getByRole('button', { name: /Reached the unloading point/ }).click();
    await expect(page.getByText('Marked · reached the unloading point')).toBeVisible();
    // The proof of delivery is not offered before unloading.
    await tab(page, /Documents/).click();
    await expect(page.getByText(/is uploaded here once the\s+truck is marked unloaded/)).toBeVisible();
    await tab(page, /Tracking/).click();
    await page.getByRole('button', { name: /Mark unloaded/ }).click();
    await expect(page.getByText(/Marked unloaded/)).toBeVisible();
    await expect(page.getByRole('table')).toContainText('Unloaded');
    await shot('09-unloaded');
  });

  test('10 · OPS uploads the E-POD on the Documents tab', async () => {
    await tab(page, /Documents/).click();
    await page.getByLabel('E-POD photo or scan').setInputFiles(photo);
    // The hard copy's courier docket is optional on the E-POD.
    await field(page, 'H-POD courier docket').fill('DTDC-55667788');
    await page.getByRole('button', { name: /Upload E-POD/ }).click();
    await expect(page.getByText(/E-POD uploaded · it can be verified now/)).toBeVisible();
    await expect(page.getByRole('img', { name: 'Proof of delivery, page 1' })).toBeVisible();
    // The E-POD closes the delivery, but the balance waits for the hard copy.
    await expect(page.getByText('Balance payment on hold')).toBeVisible();
    const hc = page.locator('.surface').filter({ has: page.getByRole('heading', { name: /Hard copy \(H-POD\)/ }) }).last();
    // The docket noted on the E-POD shows on the receiving record.
    await expect(page.locator('main')).toContainText('DTDC-55667788');
    await hc.getByLabel('Hard copy scan').setInputFiles(photo);
    await hc.getByRole('button', { name: 'Upload the hard copy' }).click();
    await expect(page.getByText(/Hard copy uploaded · verify it/)).toBeVisible();
    await shot('10-epod');
  });

  test('11 · COMPLIANCE verifies the proof; LEADERSHIP approves it', async () => {
    await signOut(page);
    await signInAs(page, 'COMPLIANCE');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    // The check opens beside the scan, like every other document; confirm it there.
    await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
    await expect(page.getByText(/Verified · a second person needs to approve/)).toBeVisible();
    // The hard copy behind the E-POD is checked too — that releases the hold on the balance.
    await page.getByRole('button', { name: /Verify the hard copy/ }).click();
    // The check opens beside the scan, like every other document; confirm it there.
    await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
    await expect(page.getByText(/Hard copy verified · the balance is no longer held/)).toBeVisible();
    await signOut(page);
    await signInAs(page, 'LEADERSHIP');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText(/Approved · the balance is unblocked/)).toBeVisible();
  });

  test('12 · FINANCE releases the balance from Details — the order is complete', async () => {
    await signOut(page);
    await signInAs(page, 'FINANCE');
    await page.goto(orderUrl);
    await page.getByRole('button', { name: /^Release/ }).first().click();
    const r = dialog(page, 'Release balance');
    await field(r, 'UTR').fill('UTR400500600');
    await r.getByRole('button', { name: 'Confirm release' }).click();
    await expect(page.getByText(/Balance released/).first()).toBeVisible();
    await page.reload();
    await expect(page.locator('main').getByText('Final payment out').first()).toBeVisible();
    await shot('12-complete');
  });
});
