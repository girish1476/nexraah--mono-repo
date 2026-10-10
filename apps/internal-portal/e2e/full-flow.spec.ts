import { Locator, Page, test, expect } from '@playwright/test';
import { DEMO_CODE } from '../src/mocks/db';
import { navFor, RoleCode } from '../src/lib/permissions';

/**
 * The whole business, end to end, the way people actually do it.
 *
 * No seeded shortcuts and no test-only sign-in: this starts from the clean
 * console (one client with one agreed rate, one transporter) and walks a single
 * load from the first indent to the last rupee, signing in as each desk in turn.
 * The console keeps its data in the browser between page loads, so every hand-off
 * between desks is a real sign-out and sign-in.
 *
 *   Operations   raise the indent, enter and accept the transporter's quote,
 *                allocate the vehicle, assign a loading supervisor
 *   Supervisor   run the loading and upload every document of the order
 *   Compliance   verify the documents
 *   Finance      release the advance
 *   ...
 */

const PEOPLE = {
  OPS: 'anil@nexraah.in',
  COMPLIANCE: 'meera@nexraah.in',
  FINANCE: 'rakesh@nexraah.in',
  BD: 'neha@nexraah.in',
  LEADERSHIP: 'vikram@nexraah.in',
  ADMIN: 'krishnan@nexraah.in',
  SUPERVISOR: 'ravi@nexraah.in',
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

function fieldControl(scope: Page | Locator, label: string) {
  return scope.locator('div.field').filter({ hasText: label }).locator('input, select, textarea');
}

const dialog = (page: Page, title: string | RegExp) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: title }) });

const row = (page: Page, text: string) => page.locator('table.table tbody tr').filter({ hasText: text });

test.describe.configure({ mode: 'serial' });

/** Details typed off each document — by Compliance, as they verify it. */
const docDetails: Record<string, Record<string, string>> = {};
// A control that never becomes usable should fail the step, not wait out the whole test.
test.use({ actionTimeout: 20_000 });

test.describe('one load, first indent to last rupee', () => {
  test.setTimeout(600_000);

  let page: Page;
  let indentId = '';
  let tripId = '';
  let tripCode = '';

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: 1500, height: 950 });
  });
  test.afterAll(async () => {
    await page.close();
  });

  test('1 · Operations raises the indent', async () => {
    await signInAs(page, 'OPS');
    await page.goto('/indents/new');
    await page.locator('select[name="clientId"]').selectOption({ label: 'Berger Paints · CONTRACT' });
    // A contract client's load comes from the agreed lane: choosing it fills the
    // route, truck and freight. The rate card is fetched once a client is chosen.
    const lane = page.locator('div.field').filter({ hasText: 'Agreed lane' }).locator('select');
    await expect(lane.locator('option', { hasText: 'Kolkata → Nashik' })).toHaveCount(1);
    await lane.selectOption({ index: 1 });
    await expect(page.locator('input[name="sellRupees"]')).toHaveValue('64200');
    await page.locator('input[name="material"]').fill('Decorative paints');
    await page.locator('input[name="weightTn"]').fill('18');
    const pickup = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await page.locator('input[name="pickupDate"]').fill(pickup);
    // On a cold dev server the first click can land while the screen is still settling; press it
    // again only while the form is still on screen.
    await expect(async () => {
      if (page.url().endsWith('/indents/new')) await page.getByRole('button', { name: 'Raise indent' }).click();
      await expect(page).toHaveURL(/\/indents\/i-\d+$/, { timeout: 4_000 });
    }).toPass({ timeout: 30_000 });
    indentId = page.url().split('/').pop()!;
    // A slow first click can be pressed twice by the retry above, so the number is not pinned.
    await expect(page.getByRole('heading', { level: 1, name: /^10\d\d$/ })).toBeVisible();
  });

  test('2 · Operations enters the transporter’s quote and accepts it: the trip is generated', async () => {
    await page.goto(`/indents/${indentId}`);
    await page.getByRole('button', { name: 'Enter a quote' }).click();
    const form = dialog(page, 'Enter a quote');
    await fieldControl(form, 'Transporter').selectOption({ label: 'Rathod Roadlines · Nashik' });
    await fieldControl(form, 'Quote (₹)').fill('57000');
    await fieldControl(form, 'Truck registration').fill('MH 15 GT 4482');
    await form.getByRole('button', { name: 'Enter quote' }).click();
    await expect(page.getByText('Quote entered')).toBeVisible();

    await page.getByRole('button', { name: 'Award' }).click();
    await expect(page.getByText(/trip \d+ generated/)).toBeVisible();
    const link = page.getByRole('link', { name: 'Open the trip' });
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    tripId = href!.split('/').pop()!;
  });

  test('3 · the vehicle is allocated and a loading supervisor assigned', async () => {
    await page.goto(`/indents/${indentId}`);
    await page.getByRole('button', { name: 'Allocate vehicle' }).click();
    const form = dialog(page, 'Allocate vehicle');
    await fieldControl(form, 'Driver mobile number').fill('9876543210');
    await fieldControl(form, 'Driver name').fill('Murugan S');
    await form.getByRole('button', { name: 'Allocate vehicle' }).click();
    // "Vehicle allocated" is also a progress tag on this page, so wait for what
    // only a saved allocation shows.
    await expect(page.getByRole('button', { name: 'Change vehicle' })).toBeVisible();

    await page.goto(`/trips/${tripId}`);
    tripCode = (await page.getByRole('heading', { level: 1 }).first().innerText()).trim();
    await page.getByRole('button', { name: 'Assign loading supervisor' }).click();
    const assign = dialog(page, 'Assign loading supervisor');
    await fieldControl(assign, 'Supervisor').selectOption({ label: 'Ravi Kumar' });
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('Loading supervisor assigned')).toBeVisible();
  });

  test('4 · the loading supervisor runs the loading and uploads every document of the order', async () => {
    await signOut(page);
    await signInAs(page, 'SUPERVISOR');
    await expect(page).toHaveURL(/\/loading$/);
    await expect(row(page, tripCode)).toBeVisible();

    await page.goto(`/trips/${tripId}`);
    await page.getByRole('button', { name: 'Start loading' }).click();
    // "Loading started" is also a permanent label in the Loading panel; the
    // button swapping to "Loading complete" is what shows the start was saved.
    await expect(page.getByRole('button', { name: 'Loading complete' })).toBeVisible();

    // Loading is finished first; the documents are uploaded after it.
    await page.getByRole('button', { name: 'Loading complete' }).click();
    await expect(page.getByText('Loading marked complete')).toBeVisible();

    await page.goto(`/trips/${tripId}/documents`);
    const scan = { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 scanned document') };
    const inTen = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
    // The file only — Compliance types the details when verifying (step 5).
    const upload = async (card: string, fill: Record<string, string> = {}) => {
      docDetails[card] = fill;
      await page.locator(`[data-doc="${card}"]`).getByRole('button', { name: /^Upload/ }).click();
      const form = page.locator('.surface').filter({ has: page.locator('input[type="file"]') }).last();
      await form.locator('input[type="file"]').setInputFiles(scan);
      await form.getByRole('button', { name: 'Upload', exact: true }).click();
      await expect(page.locator(`[data-doc="${card}"]`)).toContainText('Waiting for check');
    };
    await upload('invoice', { 'Invoice number': 'BRG/26/0412', 'Invoice value (₹)': '64200' });
    await upload('eway', { 'Vehicle number on it': 'MH 15 GT 4482', 'Valid till': inTen });
    // The vehicle papers are one PDF, with the numbers and dates typed against it.
    await upload('vehicle', {
      'RC number': 'MH15GT4482',
      'Permit valid till': nextYear,
      'Insurance (IC) valid till': nextYear,
      'Fitness valid till': nextYear,
    });
    await upload('dl', { 'Licence number': 'TN1220190045678', 'Valid till': nextYear });
    await upload('loading-slip');
  });

  test('5 · Compliance verifies the documents', async () => {
    await signOut(page);
    await signInAs(page, 'COMPLIANCE');
    await page.goto(`/trips/${tripId}/documents`);
    await expect(page.getByRole('button', { name: /^Verify$/ }).first()).toBeVisible();
    // Each card: open Verify, type the details off the document, confirm.
    for (const card of Object.keys(docDetails)) {
      await page.locator(`[data-doc="${card}"]`).getByRole('button', { name: 'Verify' }).click();
      const d = page.locator('.surface').filter({ has: page.getByRole('heading', { name: /^Verify · / }) }).last();
      for (const [label, value] of Object.entries(docDetails[card])) await fieldControl(d, label).first().fill(value);
      await d.getByRole('button', { name: 'Verify', exact: true }).click();
      await expect(page.locator(`[data-doc="${card}"]`)).toContainText('Verified');
    }
  });

  test('6 · Operations issues the lorry receipt', async () => {
    await signOut(page);
    await signInAs(page, 'OPS');
    await page.goto(`/trips/${tripId}/lr`);
    await page.getByRole('button', { name: 'Generate an E-LR' }).click();
    await page.getByRole('button', { name: 'Generate LR' }).click();
    await expect(page.getByText(/issued · the trip is open/)).toBeVisible();
  });

  test('7 · Finance releases the advance', async () => {
    await signOut(page);
    await signInAs(page, 'FINANCE');
    await page.goto('/payments/advance');
    await row(page, tripCode).getByRole('button', { name: 'Open' }).click();
    await page.getByRole('button', { name: /^Release/ }).click();
    const release = dialog(page, 'Release advance');
    await fieldControl(release, 'UTR').fill('UTR100200300');
    await release.getByRole('button', { name: 'Confirm release' }).click();
    await expect(page.getByText(/Advance released/)).toBeVisible();
  });

  test('8 · paying the advance put the truck on the road; it is tracked to the unloading point and unloaded', async () => {
    await signOut(page);
    await signInAs(page, 'OPS');
    // Loaded, documents in, advance paid: the order moved to tracking by itself.
    await page.goto('/telematics');
    await expect(page.getByText('MH 15 GT 4482').first()).toBeVisible();
    await page.goto(`/orders/${indentId}`);
    await page.getByRole('tab', { name: /Tracking/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'On the road' })).toHaveAttribute('aria-current', 'step');
    await fieldControl(page, 'Location').fill('Nagpur bypass');
    await page.getByRole('button', { name: 'Add update' }).click();
    await expect(page.getByText('Tracking updated')).toBeVisible();
    await page.getByRole('button', { name: /Reached the unloading point/ }).click();
    await expect(page.getByText('Marked · reached the unloading point')).toBeVisible();
    await page.getByRole('button', { name: /Mark unloaded/ }).click();
    await expect(page.getByText(/Marked unloaded/)).toBeVisible();
  });

  test('9 · the proof of delivery is received, verified, and approved by a second person', async () => {
    await signOut(page);
    await signInAs(page, 'COMPLIANCE');
    // The paper copy is logged right on the proof page — the same panel the
    // order page's Documents tab shows — rather than only on the register.
    await page.goto(`/pod/${tripId}/verify`);
    await expect(page.getByRole('heading', { name: 'Receive the proof of delivery' })).toBeVisible();
    // The signed hard copy (H-POD) — just its scan; E-POD is the other way in.
    await page.getByRole('tab', { name: /H-POD/ }).click();
    await page.getByLabel('H-POD scan').setInputFiles({
      name: 'hpod.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 signed hard copy'),
    });
    await page.getByRole('button', { name: /Upload H-POD/ }).click();
    await expect(page.getByText(/H-POD uploaded · the clock has stopped/)).toBeVisible();

    await page.getByRole('button', { name: 'Verify', exact: true }).click();
    // The check opens beside the scan, like every other document. The shortage
    // written on the proof is ticked here — that is what raises the SDR; there
    // is no entering one by hand on the SDR screen.
    await page.getByText('Fewer goods arrived than were sent').click();
    await page.getByPlaceholder(/bags short/).fill('Six drums short at the consignee gate');
    await fieldControl(page, 'Believed to cost').fill('2000');
    await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
    await expect(page.getByText(/Verified · SDR-\d+ raised/)).toBeVisible();

    await signOut(page);
    await signInAs(page, 'LEADERSHIP');
    await page.goto(`/pod/${tripId}/verify`);
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/Approved/).first()).toBeVisible();
  });

  test('10 · the shortage noted at verification is on the SDR list and is resolved: the payment goes out after the deduction', async () => {
    await page.goto('/sdr');
    await expect(page.getByRole('button', { name: 'Record shortage or damage' })).toHaveCount(0);
    await expect(row(page, tripCode)).toContainText('Six drums short at the consignee gate');
    await row(page, tripCode).getByRole('button', { name: 'Resolve' }).click();
    const resolve = dialog(page, /^Resolve SDR-/);
    await fieldControl(resolve, 'Amount to deduct').fill('2000');
    await resolve.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText(/resolved — ₹2,000 comes off the payment/)).toBeVisible();
  });

  test('11 · Finance releases the balance after the deduction', async () => {
    await signOut(page);
    await signInAs(page, 'FINANCE');
    await page.goto('/payments/balance');
    const r = row(page, tripCode);
    await expect(r.locator('td[data-label="Shortage / damage"]')).toHaveText('₹2,000');
    await r.getByRole('button', { name: 'Open' }).click();
    await page.getByRole('button', { name: /^Release/ }).click();
    const release = dialog(page, 'Release balance');
    await fieldControl(release, 'UTR').fill('UTR400500600');
    await release.getByRole('button', { name: 'Confirm release' }).click();
    await expect(page.getByText(/Balance released/)).toBeVisible();
  });

  test('12 · Finance bills the client for the delivered load', async () => {
    await page.goto('/invoices/new');
    await page.locator('select').first().selectOption({ label: 'Berger Paints' });
    await row(page, tripCode).locator('input[type="checkbox"]').check();
    await page.getByRole('button', { name: 'Generate invoice' }).click();
    await expect(page.getByText(/NEX-INV-\d+ issued/)).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/[^/]+$/);
  });

  test('13 · Finance records the client’s payment against the invoice', async () => {
    await page.goto('/receivables');
    await page.getByRole('button', { name: /Record/ }).first().click();
    const rec = dialog(page, 'Record a receipt');
    await fieldControl(rec, 'UTR or cheque number').fill('UTR900800700');
    await rec.getByRole('button', { name: 'Record receipt' }).click();
    await expect(page.getByText(/Receipt .* recorded|recorded/i).first()).toBeVisible();
  });

  test('14 · Finance onboards a new client', async () => {
    await page.goto('/today');
    if (!(await page.getByRole('button', { name: 'Sign out' }).isVisible())) {
      // (running these steps on their own: nobody is signed in yet)
    } else {
      await signOut(page);
    }
    await signInAs(page, 'FINANCE');
    await page.goto('/clients/new');
    await page.locator('[name="name"]').fill('Sundaram Auto Components');
    await page.locator('[name="billingCity"]').fill('Hosur');
    await page.locator('[name="billingAddress"]').fill('Plot 12, SIPCOT Phase II');
    await page.locator('[name="billingState"]').fill('Tamil Nadu');
    await page.locator('[name="billingPincode"]').fill('635109');
    await page.locator('[name="contact"]').fill('R. Venkat');
    await page.locator('[name="phone"]').fill('9843012345');
    await page.locator('[name="email"]').fill('logistics@sundaram.example');
    await page.locator('[name="agreementNo"]').fill('SAC/RC/2026-27');
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText(/added$/)).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/c-/);
    await expect(page.getByRole('heading', { name: 'Sundaram Auto Components' })).toBeVisible();
  });

  test('15 · Compliance checks the client’s papers and clears them for work', async () => {
    await signOut(page);
    await signInAs(page, 'COMPLIANCE');
    await page.goto('/clients/onboarding');
    await row(page, 'Sundaram Auto Components').getByRole('button', { name: /Open|Review/ }).click();
    const file = dialog(page, /Sundaram Auto Components/);
    await expect(file.getByRole('button', { name: 'Mark received' }).first()).toBeVisible();
    let received = await file.getByRole('button', { name: 'Mark received' }).count();
    while (received > 0) {
      await file.getByRole('button', { name: 'Mark received' }).first().click();
      received -= 1;
      await expect(file.getByRole('button', { name: 'Mark received' })).toHaveCount(received);
    }
    // Accept every paper still waiting (the button is disabled once one is accepted).
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

  test('16 · BD adds the client’s rate — with the approval mail and the late-delivery terms — and Compliance signs it off', async () => {
    await signOut(page);
    await signInAs(page, 'BD');
    await page.goto('/clients/rate-changes');
    await page.locator('select').first().selectOption({ label: 'Sundaram Auto Components · Hosur' });
    await page.getByRole('button', { name: /Add a lane/ }).first().click();
    const lane = dialog(page, /^Add a lane/);
    await lane.getByPlaceholder('e.g. 32 ft MXL').fill('32 ft MXL');
    await fieldControl(lane, 'Transit days').fill('2');
    await lane.locator('div.field').filter({ hasText: 'From location' }).locator('input').fill('Hosur');
    await lane.locator('div.field').filter({ hasText: 'To location' }).locator('input').fill('Pune');
    await fieldControl(lane, 'Lane rate per truck (₹)').fill('52000');
    await fieldControl(lane, 'Late-delivery penalty').selectOption('YES');
    await fieldControl(lane, 'Penalty per late day (₹)').fill('750');
    await fieldControl(lane, 'Approval mail subject').fill('RE: Sundaram Hosur–Pune rate approved by BD and Leadership');
    await lane.locator('div.field').filter({ hasText: 'Where this rate was agreed' }).locator('textarea').fill('Annexure 1 of the agreement signed on 2 September');
    await lane.getByRole('button', { name: 'Send for sign-off' }).click();
    await expect(page.getByText(/Sent for sign-off/)).toBeVisible();

    await signOut(page);
    await signInAs(page, 'COMPLIANCE');
    await page.goto('/admin/approvals');
    await expect(page.getByText(/mail: RE: Sundaram Hosur–Pune rate approved by BD and Leadership/)).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).first().click();
    await expect(page.getByText(/Approved/).first()).toBeVisible();
  });

  test('17 · Operations raises an indent for the new client on the new lane', async () => {
    await signOut(page);
    await signInAs(page, 'OPS');
    await page.goto('/indents/new');
    await page.locator('select[name="clientId"]').selectOption({ label: 'Sundaram Auto Components · CONTRACT' });
    const lane = page.locator('div.field').filter({ hasText: 'Agreed lane' }).locator('select');
    await expect(lane.locator('option', { hasText: 'Hosur → Pune' })).toHaveCount(1);
    await lane.selectOption({ index: 1 });
    await expect(page.locator('input[name="sellRupees"]')).toHaveValue('52000');
    await page.locator('input[name="material"]').fill('Brake assemblies');
    await page.locator('input[name="weightTn"]').fill('14');
    await page.locator('input[name="pickupDate"]').fill(new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10));
    await page.getByRole('button', { name: 'Raise indent' }).click();
    await expect(page).toHaveURL(/\/indents\/i-\d+$/);
    await expect(page.getByRole('heading', { name: '1002' })).toBeVisible();
  });

  test('18 · every tab, for every desk, opens without breaking — with the finished load in the books', async () => {
    const desks: [keyof typeof PEOPLE, RoleCode][] = [
      ['OPS', 'OPS'],
      ['COMPLIANCE', 'COMPLIANCE'],
      ['FINANCE', 'FINANCE'],
      ['BD', 'BD'],
      ['LEADERSHIP', 'LEADERSHIP'],
      ['ADMIN', 'ADMIN'],
      ['SUPERVISOR', 'LOADING_SUPERVISOR'],
    ];
    const broken: string[] = [];
    page.on('pageerror', (e) => broken.push(`page error: ${e.message}`));

    for (const [who, role] of desks) {
      await signOut(page);
      await signInAs(page, who);
      const hrefs = navFor(role).flatMap((g) => g.items.map((i) => i.href));
      // The record pages every desk reaches from those lists.
      const records = [
        `/indents/${indentId}`,
        `/trips/${tripId}`,
        `/trips/${tripId}/documents`,
        `/trips/${tripId}/lr`,
        `/orders/${indentId}`,
        `/pod/${tripId}/verify`,
        '/orders',
        '/search',
      ];
      for (const href of [...new Set([...hrefs, ...records])]) {
        const before = broken.length;
        await page.goto(href);
        await expect(page.locator('main, [role="main"], body').first()).toBeVisible();
        // Let the screen finish its own fetches before judging it.
        await page.waitForTimeout(700);
        const text = await page.locator('body').innerText();
        if (/Unhandled Runtime Error/.test(text)) broken.push(`${who} ${href}: the screen crashed`);
        if (/Could not load this screen/.test(text)) broken.push(`${who} ${href}: could not load`);
        if (broken.length > before && !broken[broken.length - 1].startsWith(who)) {
          broken[broken.length - 1] = `${who} ${href}: ${broken[broken.length - 1]}`;
        }
      }
    }
    expect(broken, broken.join(', ')).toEqual([]);
  });

  test('19 · clearing the work leaves exactly one client and one transporter, and no loads', async () => {
    await signOut(page);
    await page.getByRole('button', { name: 'Clear my work and start over' }).click();
    await expect(page.getByRole('button', { name: 'Clear my work and start over' })).toBeVisible();
    await signInAs(page, 'OPS');

    // Every record the walk-through made is gone…
    await page.goto('/orders');
    await expect(page.locator('main table tbody tr')).toHaveCount(0);
    await page.goto('/trips');
    await expect(page.locator('main table tbody tr')).toHaveCount(0);

    // …and the one client and one transporter it started with are still there.
    await page.goto('/clients');
    await expect(page.locator('main table tbody tr')).toHaveCount(1);
    await expect(page.getByText('Sundaram Auto Components')).toHaveCount(0);
    await page.goto('/vendors');
    await expect(page.locator('main table tbody tr')).toHaveCount(1);
  });
});
