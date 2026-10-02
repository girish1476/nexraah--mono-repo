import { Locator, Page, test, expect } from '@playwright/test';
import { DEMO_CODE } from '../src/mocks/db';

/**
 * Real data, entered the way a person enters it, from a clean console:
 * a new transporter onboarded and activated, a new client onboarded and
 * cleared with an agreed rate, then one load from indent to final payment
 * and invoice — every desk signing in in turn. Nothing seeded is used except
 * the people who sign in.
 */

const PEOPLE = {
  OPS: 'anil@nexraah.in',
  COMPLIANCE: 'meera@nexraah.in',
  FINANCE: 'rakesh@nexraah.in',
  BD: 'neha@nexraah.in',
  LEADERSHIP: 'vikram@nexraah.in',
  SUPERVISOR: 'ravi@nexraah.in',
  ADMIN: 'krishnan@nexraah.in',
} as const;

async function signInAs(page: Page, who: keyof typeof PEOPLE) {
  if (await page.getByRole('button', { name: 'Sign out' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/signin$/, { timeout: 30_000 });
  }
  await page.goto('/signin');
  await page.getByRole('textbox', { name: 'Email' }).fill(PEOPLE[who]);
  await page.getByRole('button', { name: /^Send me a code/ }).click();
  // Filling the first box with the whole code is what a paste or a phone's
  // one-time-code autofill does; the form signs in on the last digit.
  await page.getByLabel('Digit 1').fill(DEMO_CODE);
  await expect(page).not.toHaveURL(/\/signin$/, { timeout: 30_000 });
}

const field = (scope: Page | Locator, label: string) =>
  scope.locator('div.field').filter({ hasText: label }).locator('input, select, textarea').first();
const dialog = (page: Page, title: string | RegExp) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: title }) }).last();
const tab = (page: Page, name: RegExp) => page.getByRole('tab', { name });

/** Details typed off each document — by Compliance, as they verify it. */
const details: Record<string, Record<string, string>> = {};

async function verifyCard(page: Page, card: string) {
  await page.locator(`[data-doc="${card}"]`).getByRole('button', { name: 'Verify' }).click();
  const d = page.locator('.surface').filter({ has: page.getByRole('heading', { name: /^Verify · / }) }).last();
  for (const [label, value] of Object.entries(details[card] ?? {})) await field(d, label).fill(value);
  await d.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator(`[data-doc="${card}"]`)).toContainText('Verified');
}
const rowOf = (page: Page, text: string) => page.locator('table.table tbody tr').filter({ hasText: text });

const img = { name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
) };
const pdf = { name: 'papers.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 papers') };
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const VENDOR = 'Sri Balaji Roadways';
const CLIENT = 'Kaveri Agro Foods';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 20_000 });

test.describe('real data, end to end', () => {
  test.setTimeout(300_000);
  let page: Page;
  let orderUrl = '';
  let vendorUrl = '';
  const shot = async (name: string) => {
    const dir = process.env.CYCLE_SHOTS;
    if (dir) await page.screenshot({ path: `${dir}/real-${name}.png`, fullPage: true });
  };

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: 1440, height: 950 });
  });
  test.afterAll(async () => page.close());

  test('1 · OPS onboards a new transporter', async () => {
    await signInAs(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');
    await field(main, 'Legal name').fill(VENDOR);
    await field(main, 'Base city').fill('Nashik');
    await field(main, 'Phone').fill('9823456781');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(main.getByText('2 · Identity and legal file')).toBeVisible();

    // Every identity and legal paper: a reference where asked, and the file.
    const refs: Record<string, string> = {
      'PAN card': 'ABCPB1234K',
      'Aadhaar card': '4321',
      'Address proof': 'EB bill 2026-09',
      'Registration certificate': 'MH15AB9911',
      'Signed transporter agreement': 'AGR-2026-77',
    };
    // A captured row drops its file input, so the first input left is always the next row.
    for (let guard = 0; guard < 12; guard++) {
      const inputs = main.locator('input[type="file"]');
      const n = await inputs.count();
      if (n === 0) break;
      const r = inputs.first().locator('xpath=..');
      const text = (await r.innerText()).split('\n')[0].trim();
      const ref = r.locator('input:not([type="file"])');
      if (await ref.count()) await ref.first().fill(refs[text] ?? 'REF-001');
      await r.locator('input[type="file"]').setInputFiles(img);
      await r.getByRole('button', { name: 'Capture' }).click();
      await expect(main.locator('input[type="file"]')).toHaveCount(n - 1, { timeout: 15_000 });
    }
    await shot('01-vendor-docs');
    await main.getByRole('button', { name: 'Continue' }).click();
    await expect(main.getByText('3 · Fleet')).toBeVisible();
    await field(main, 'Trucks').fill('6');
    const truckTypes = main.locator('div.field').filter({ hasText: 'Truck types' });
    await truckTypes.locator('select').selectOption({ index: 1 });
    await truckTypes.getByRole('button').first().click();
    await main.locator('select[multiple]').selectOption(['MH', 'WB']);
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(main.getByText('4 · Payment')).toBeVisible();
    await field(main, 'Account number').fill('50100234567890');
    await field(main, 'IFSC').fill('HDFC0001234');
    await field(main, 'Account holder').fill(VENDOR);
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(main.getByText('5 · Review and submit')).toBeVisible();
    await shot('02-vendor-review');
    await main.getByRole('button', { name: 'Submit for verification' }).click();
    await expect(page).toHaveURL(/\/vendors\/v-/);
    vendorUrl = new URL(page.url()).pathname;
  });

  test('2 · COMPLIANCE verifies every paper and activates the transporter', async () => {
    await signInAs(page, 'COMPLIANCE');
    await page.goto(vendorUrl);
    await expect(page.getByRole('heading', { name: VENDOR }).first()).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Verify', exact: true }).first()).toBeVisible();
    const verify = page.locator('main').getByRole('button', { name: 'Verify', exact: true });
    for (let guard = 0; guard < 15 && (await verify.count()) > 0; guard++) {
      const before = await verify.count();
      await verify.first().click();
      await expect(verify).toHaveCount(before - 1);
    }
    await shot('03-vendor-verified');
    await page.getByRole('button', { name: 'Clear and activate' }).click();
    await page.getByRole('button', { name: 'Activate', exact: true }).click();
    await expect(page.getByText('Vendor active')).toBeVisible();
  });

  test('3 · FINANCE onboards the client; COMPLIANCE clears them', async () => {
    await signInAs(page, 'FINANCE');
    await page.goto('/clients/new');
    await page.locator('[name="name"]').fill(CLIENT);
    await page.locator('[name="billingCity"]').fill('Nashik');
    await page.locator('[name="contact"]').fill('S. Patil');
    await page.locator('[name="phone"]').fill('9822011223');
    await page.locator('[name="email"]').fill('logistics@kaveri.example');
    await page.locator('[name="agreementNo"]').fill('KAF/RC/2026-27');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page).toHaveURL(/\/clients\/c-/);

    await signInAs(page, 'COMPLIANCE');
    await page.goto('/clients/onboarding');
    await rowOf(page, CLIENT).getByRole('button', { name: /Open|Review/ }).click();
    const file = dialog(page, new RegExp(CLIENT));
    await expect(file.getByRole('button', { name: 'Mark received' }).first()).toBeVisible();
    let received = await file.getByRole('button', { name: 'Mark received' }).count();
    while (received > 0) {
      await file.getByRole('button', { name: 'Mark received' }).first().click();
      received -= 1;
      await expect(file.getByRole('button', { name: 'Mark received' })).toHaveCount(received);
    }
    const acceptable = file.locator('button:not([disabled])', { hasText: /^Accept$/ });
    await expect(acceptable.first()).toBeVisible();
    let toAccept = await acceptable.count();
    while (toAccept > 0) {
      await acceptable.first().click();
      toAccept -= 1;
      await expect(acceptable).toHaveCount(toAccept);
    }
    await file.getByRole('button', { name: 'Clear this client' }).click();
    await expect(page.getByText(/is cleared for work/)).toBeVisible();
  });

  test('4 · BD adds the client’s rate; COMPLIANCE signs it off', async () => {
    await signInAs(page, 'BD');
    await page.goto('/clients/rate-changes');
    const sel = page.locator('select').first();
    await sel.selectOption({ label: (await sel.locator('option', { hasText: CLIENT }).first().textContent())!.trim() });
    await page.getByRole('button', { name: /Add a lane/ }).first().click();
    const lane = dialog(page, /^Add a lane/);
    await lane.getByPlaceholder('e.g. 32 ft MXL').fill('32 ft MXL');
    await field(lane, 'Transit days').fill('3');
    await field(lane, 'From location').fill('Nashik');
    await field(lane, 'To location').fill('Kolkata');
    await field(lane, 'Lane rate per truck (₹)').fill('98000');
    await field(lane, 'Approval mail subject').fill('RE: Kaveri Nashik–Kolkata rate approved');
    await field(lane, 'Where this rate was agreed').fill('Client mail of 1 October agreeing the rate');
    await lane.getByRole('button', { name: 'Send for sign-off' }).click();
    await expect(page.getByText(/Sent for sign-off/)).toBeVisible();

    await signInAs(page, 'COMPLIANCE');
    await page.goto('/admin/approvals');
    const card = page.locator('.surface, tr, li').filter({ hasText: 'RE: Kaveri Nashik–Kolkata rate approved' }).last();
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/Approved/).first()).toBeVisible();
  });

  test('5 · OPS raises the indent; the new transporter quotes; OPS awards and allocates', async () => {
    await signInAs(page, 'OPS');
    await page.goto('/indents/new');
    await page.locator('select[name="clientId"]').selectOption({ label: `${CLIENT} · CONTRACT` });
    const lane = field(page, 'Agreed lane');
    await expect(lane.locator('option', { hasText: 'Nashik → Kolkata' })).toHaveCount(1);
    await lane.selectOption({ index: 1 });
    await page.locator('input[name="material"]').fill('Packaged rice');
    await page.locator('input[name="weightTn"]').fill('22');
    await page.locator('input[name="pickupDate"]').fill(day(1));
    await page.locator('textarea[name="pickupAddress"]').fill('Kaveri warehouse, Sinnar MIDC, Nashik');
    await page.locator('textarea[name="dropAddress"]').fill('Kaveri depot, Dankuni, Kolkata');
    await page.getByRole('button', { name: 'Raise indent' }).click();
    await expect(page).toHaveURL(/\/indents\/i-\d+$/);
    orderUrl = `/orders/${page.url().split('/').pop()}`;

    await page.getByRole('button', { name: 'Enter a quote' }).click();
    const q = dialog(page, 'Enter a quote');
    await field(q, 'Transporter').selectOption({ label: new RegExp(VENDOR) as unknown as string }).catch(async () => {
      const opt = await field(q, 'Transporter').locator('option', { hasText: VENDOR }).first().getAttribute('value');
      await field(q, 'Transporter').selectOption(opt!);
    });
    await field(q, 'Quote (₹)').fill('91000');
    await q.getByRole('button', { name: 'Enter quote' }).click();
    await expect(page.getByText('Quote entered')).toBeVisible();

    await page.goto(orderUrl);
    await page.getByRole('button', { name: /^(Award|Request approval)$/ }).first().click();
    await expect(page.getByText(/Awarded to/)).toBeVisible();
    await page.getByRole('button', { name: 'Allocate vehicle' }).first().click();
    const a = dialog(page, 'Allocate vehicle');
    await field(a, 'Vehicle number').fill('MH 15 AB 9911');
    await field(a, 'Driver mobile number').fill('9765432109');
    await a.getByRole('button', { name: 'Allocate vehicle' }).last().click();
    // Vehicle assigned: the order goes for tracking, with the truck on it.
    await expect(page.getByText('Where the truck is · MH 15 AB 9911')).toBeVisible();
    await shot('04-allocated');
  });

  test('6 · loading: supervisor assigned, loading run, documents uploaded after it', async () => {
    const tripLink = page.locator('.record-status').getByRole('link').nth(1);
    const tripUrl = (await tripLink.getAttribute('href'))!;
    const tripCode = (await tripLink.innerText()).trim();
    // The supervisor is assigned from the order's own Next step.
    await tab(page, /Details/).click();
    await page.getByRole('button', { name: /Assign loading supervisor/ }).click();
    const assign = dialog(page, 'Assign loading supervisor');
    await field(assign, 'Supervisor').selectOption({ label: 'Ravi Kumar' });
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('Loading supervisor assigned')).toBeVisible();
    await expect(page.getByText('Loading supervisor · Ravi Kumar')).toBeVisible();

    // The order is on the supervisor's own screen.
    await signInAs(page, 'SUPERVISOR');
    await page.goto('/loading');
    await expect(page.locator('main')).toContainText(tripCode);
    await page.goto(tripUrl);
    await page.getByRole('button', { name: 'Start loading' }).click();
    await page.getByRole('button', { name: 'Loading complete' }).click();
    await expect(page.getByText('Loading marked complete')).toBeVisible();
    await page.goto(`${tripUrl}/documents`);
    // The uploader attaches the file only; the details on it are typed by the
    // verification team when they verify it (see `verifyCard`).
    const upload = async (card: string, file: typeof img, fill: Record<string, string>) => {
      details[card] = fill;
      await page.locator(`[data-doc="${card}"]`).getByRole('button', { name: /^Upload/ }).click();
      const d = page.locator('.surface').filter({ has: page.locator('input[type="file"]') }).last();
      await d.locator('input[type="file"]').setInputFiles(file);
      await d.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(page.locator(`[data-doc="${card}"]`)).toContainText('Waiting for check');
    };
    await upload('invoice', img, { 'Invoice number': 'KAF/26/1001', 'Invoice value (₹)': '1250000' });
    await upload('eway', img, { 'Vehicle number on it': 'MH 15 AB 9911', 'Valid till': day(6) });
    await upload('vehicle', pdf, { 'RC number': 'MH15AB9911', 'Permit valid till': day(300), 'Insurance (IC) valid till': day(300), 'Fitness valid till': day(300) });
    await upload('dl', img, { 'Licence number': 'MH1520200012345', 'Valid till': day(800) });
    await upload('loading-slip', img, { 'Packages loaded': '880', 'Weight loaded (MT)': '22' });
    await shot('05-docs');
  });

  test('7 · COMPLIANCE verifies, FINANCE pays the advance: the truck is on the road', async () => {
    await signInAs(page, 'COMPLIANCE');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    for (const card of ['invoice', 'eway', 'vehicle', 'dl', 'loading-slip']) {
      await verifyCard(page, card);
    }
    await signInAs(page, 'FINANCE');
    await page.goto(orderUrl);
    await page.getByRole('button', { name: /^Release/ }).first().click();
    const r = dialog(page, 'Release advance');
    await field(r, 'UTR').fill('UTR555666777');
    await r.getByRole('button', { name: 'Confirm release' }).click();
    await expect(page.getByText(/Advance released/).first()).toBeVisible();
    await page.reload();
    await expect(page.locator('main').getByText('On the road').first()).toBeVisible();
    await shot('06-on-road');
  });

  test('8 · OPS tracks and unloads; E-POD then the hard copy; verified and approved', async () => {
    await signInAs(page, 'OPS');
    await page.goto(orderUrl);
    await tab(page, /Tracking/).click();
    await field(page, 'Location').fill('Raipur');
    await page.getByRole('button', { name: 'Add update' }).click();
    await expect(page.getByText('Tracking updated')).toBeVisible();
    await page.getByRole('button', { name: /Reached the unloading point/ }).click();
    await page.getByRole('button', { name: /Mark unloaded/ }).click();
    await expect(page.getByText(/Marked unloaded/)).toBeVisible();
    await tab(page, /Documents/).click();
    await page.getByLabel('E-POD photo or scan').setInputFiles(img);
    await page.getByRole('button', { name: /Upload E-POD/ }).click();
    await expect(page.getByText(/E-POD uploaded/)).toBeVisible();
    // The signed hard copy arrives later: its scan is uploaded against the E-POD.
    await page.getByLabel('Hard copy scan').setInputFiles(img);
    await page.getByRole('button', { name: 'Upload the hard copy' }).click();
    await expect(page.getByText(/Hard copy uploaded · verify it/)).toBeVisible();

    await signInAs(page, 'COMPLIANCE');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    // The check opens beside the scan, like every other document; confirm it there.
    await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
    await expect(page.getByText(/Verified · a second person/)).toBeVisible();
    await page.getByRole('button', { name: /Verify the hard copy/ }).click();
    // The check opens beside the scan, like every other document; confirm it there.
    await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
    await expect(page.getByText(/Hard copy verified · the balance is no longer held/)).toBeVisible();
    await signInAs(page, 'LEADERSHIP');
    await page.goto(orderUrl);
    await tab(page, /Documents/).click();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText(/Approved · the balance is unblocked/)).toBeVisible();
    await shot('07-pod');
  });

  test('9 · FINANCE pays the balance, invoices the client and records the payment', async () => {
    await signInAs(page, 'FINANCE');
    await page.goto(orderUrl);
    await page.getByRole('button', { name: /^Release/ }).first().click();
    const r = dialog(page, 'Release balance');
    await field(r, 'UTR').fill('UTR888999000');
    await r.getByRole('button', { name: 'Confirm release' }).click();
    await expect(page.getByText(/Balance released/).first()).toBeVisible();

    await page.goto('/invoices');
    await rowOf(page, CLIENT).getByRole('link', { name: 'Raise invoice' }).click();
    await page.getByRole('button', { name: 'Generate invoice' }).click();
    await expect(page.getByText(/NEX-INV-\d+ issued/)).toBeVisible();

    await page.goto('/receivables');
    await page.getByRole('button', { name: /Record/ }).first().click();
    const rec = dialog(page, 'Record a receipt');
    await field(rec, 'UTR or cheque number').fill('UTR121212121');
    await rec.getByRole('button', { name: 'Record receipt' }).click();
    await expect(page.getByText(/recorded/i).first()).toBeVisible();

    await page.goto(orderUrl);
    await expect(page.locator('main').getByText('Final payment out').first()).toBeVisible();
    await shot('08-done');
  });

  test('10 · ADMIN adds a person; they can sign in, even after a reload', async () => {
    await signInAs(page, 'ADMIN');
    await page.goto('/admin/users');
    await page.getByRole('button', { name: /Allow an email|Add/ }).first().click();
    const add = dialog(page, 'Allow an email to sign in');
    await field(add, 'Email').fill('priya@nexraah.in');
    await field(add, 'Role').selectOption('OPS');
    await field(add, 'Name').fill('Priya Menon');
    await add.getByRole('button', { name: 'Allow' }).click();
    await expect(page.getByText(/priya@nexraah.in can now sign in/)).toBeVisible();
    await page.reload();
    await expect(page.locator('main')).toContainText('priya@nexraah.in');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.goto('/signin');
    await page.getByRole('textbox', { name: 'Email' }).fill('priya@nexraah.in');
    await page.getByRole('button', { name: /^Send me a code/ }).click();
    await page.getByLabel('Digit 1').fill(DEMO_CODE);
    await expect(page).not.toHaveURL(/\/signin$/, { timeout: 30_000 });
    await expect(page.getByText('Priya Menon').first()).toBeVisible();
    // And she sees the same orders the rest of the business entered.
    await page.goto('/orders');
    await page.getByText(/All shipments/).first().click();
    await expect(page.locator('main')).toContainText(CLIENT);
  });
});
