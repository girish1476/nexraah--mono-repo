import { test, expect, Page } from '@playwright/test';
import { setRole } from './helpers';

/**
 * `/trips` and `/trips/[id]` — part 05. Fixture data (`src/mocks/db.ts`)
 * seeds exactly four trips:
 *
 *   TRP-120881  Berger Paints · Rathod Roadlines · Nashik → Kolkata
 *               DELIVERED · POD PENDING · buy ₹58,400 · advance not
 *               released · documents from `tripDocs()` (partially verified)
 *   TRP-120874  Berger Paints · Sai Kripa Carriers · Pune → Surat
 *               DELIVERED · POD ATTACHED · advance already released
 *   TRP-120869  Apex Ceramics · Bhagwati Logistics · Hosur → Gurugram
 *               IN_TRANSIT · POD RECEIVED · advance already released
 *   TRP-120855  Apex Ceramics · Anand Roadways · Gandhidham → Jaipur
 *               DELIVERED · POD APPROVED · advance already released ·
 *               balance gate fully cleared (the one trip with nothing
 *               blocking it)
 *
 * No fixture user carries a branch, so every role sees every trip.
 */

const panel = (page: Page, heading: string) =>
  page.locator('.surface', { has: page.getByRole('heading', { name: heading, exact: true }) });
const field = (page: Page, label: string) => page.locator('.field').filter({ has: page.getByText(label, { exact: true }) });
const fact = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..').locator('.mono');

test.describe('trips list', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips');
    await expect(page.getByRole('heading', { name: 'Trips on the road', exact: true })).toBeVisible();
  });

  test('renders all four seeded trips with the right columns', async ({ page }) => {
    const headers = page.locator('table.table thead th');
    await expect(headers).toHaveText([
      'Trip number',
      'Client',
      'Transporter',
      'Route',
      'Vehicle',
      'Delivered',
      'Transporter cost',
      'How far along',
      'Delivery proof',
    ]);

    const rows = page.locator('table.table tbody tr');
    await expect(rows).toHaveCount(4);
    for (const code of ['TRP-120881', 'TRP-120874', 'TRP-120869', 'TRP-120855']) {
      await expect(page.getByRole('link', { name: code })).toBeVisible();
    }
  });

  test('search narrows to an exact trip code', async ({ page }) => {
    const search = page.getByPlaceholder('Any of the above');
    await search.fill('TRP-120855');
    await search.press('Enter');
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'TRP-120855' })).toBeVisible();
  });

  test('search by client name matches every trip for that client', async ({ page }) => {
    const search = page.getByPlaceholder('Any of the above');
    await search.fill('Berger Paints');
    await search.press('Enter');
    await expect(page.locator('table.table tbody tr')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'TRP-120881' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'TRP-120874' })).toBeVisible();
  });

  test('a search with no matches shows the empty state, not a broken table', async ({ page }) => {
    const search = page.getByPlaceholder('Any of the above');
    await search.fill('zzz-does-not-exist');
    await search.press('Enter');
    await expect(page.getByText('No trip matches this search')).toBeVisible();
    await expect(page.locator('table.table')).toHaveCount(0);
  });

  test('stage filter narrows to the one IN_TRANSIT trip', async ({ page }) => {
    await field(page, 'Stage').locator('select').selectOption('IN_TRANSIT');
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'TRP-120869' })).toBeVisible();
  });

  test('POD status filter narrows to the one APPROVED trip', async ({ page }) => {
    await field(page, 'POD status').locator('select').selectOption('APPROVED');
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'TRP-120855' })).toBeVisible();
  });

  test('FINANCE gets a read-only badge (VIEW-level on trips)', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/trips');
    await expect(page.getByTestId('view-only')).toBeVisible();
  });

  test('clicking a trip code opens its detail page', async ({ page }) => {
    await page.getByRole('link', { name: 'TRP-120881' }).click();
    await expect(page).toHaveURL(/\/trips\/t-120881$/);
    await expect(page.getByRole('heading', { name: 'TRP-120881', exact: true })).toBeVisible();
  });

  test('clicking elsewhere in a row also navigates (DataTable row-click)', async ({ page }) => {
    await page.getByText('Hosur → Gurugram').click();
    await expect(page).toHaveURL(/\/trips\/t-120869$/);
    await expect(page.getByRole('heading', { name: 'TRP-120869', exact: true })).toBeVisible();
  });
});

test.describe('trip detail — TRP-120881 (OPS, edit)', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips/t-120881');
    await expect(page.getByRole('heading', { name: 'TRP-120881', exact: true })).toBeVisible();
  });

  test('identifiers, truck/driver and money fact lists render seeded values', async ({ page }) => {
    await expect(fact(page, 'Lorry receipt')).toHaveText('LR-88214');
    await expect(fact(page, 'Indent')).toHaveText('IND-4443');
    await expect(fact(page, 'Client')).toHaveText('Berger Paints');
    await expect(fact(page, 'Transporter')).toHaveText('Rathod Roadlines');
    await expect(fact(page, 'Branch')).toHaveText('Nashik');

    await expect(fact(page, 'Vehicle')).toHaveText('MH 15 GT 4482');
    await expect(fact(page, 'Type')).toHaveText('32 ft SXL · 21 MT');
    await expect(fact(page, 'Load')).toHaveText('19 MT');
    await expect(fact(page, 'Utilisation')).toHaveText('90%');
    await expect(fact(page, 'Driver')).toHaveText('Sandeep Rathod');

    await expect(fact(page, 'Buy rate')).toHaveText('₹58,400');
    await expect(fact(page, 'Charges (cost)')).toHaveText('₹1,800');
    await expect(fact(page, 'Charges (billed)')).toHaveText('₹2,200');
    await expect(fact(page, 'Advance paid')).toHaveText('₹0');
    await expect(fact(page, 'POD penalty')).toHaveText('₹400');
  });

  test('the indent link in Identifiers goes to the indent detail page', async ({ page }) => {
    await page.getByRole('link', { name: 'IND-4443' }).click();
    await expect(page).toHaveURL(/\/indents\/i-4443$/);
  });

  test('timing panel shows the transit delay banner and carried-over remarks', async ({ page }) => {
    const timing = panel(page, 'Timing');
    await expect(timing.getByText('Waiting on the transporter', { exact: true })).toBeVisible();
    await expect(page.getByText('Transit delay', { exact: true })).toBeVisible();
    await expect(page.getByText('Reporting was later than')).toBeVisible();
    await expect(page.getByText('Remarks carried from the indent: Stack no more than three high.')).toBeVisible();
  });

  test('the e-way bill panel shows "not captured" for a trip with no e-way data', async ({ page }) => {
    await expect(fact(page, 'Number')).toHaveText('not captured');
    await expect(fact(page, 'Valid till')).toHaveText('—');
  });

  test('advance gate is blocked on the unverified/missing documents', async ({ page }) => {
    await expect(page.getByText('Advance blocked')).toBeVisible();
    await expect(page.getByText('E-way bill not uploaded')).toBeVisible();
    await expect(page.getByText('Registration certificate uploaded but not verified')).toBeVisible();
    await expect(page.getByText('Driving licence not uploaded')).toBeVisible();
    // OPS lacks payment.release — no release control is ever rendered, blocked or not.
    await expect(page.getByRole('button', { name: /^Release/ })).toHaveCount(0);
  });

  test('balance gate is blocked on POD not being approved', async ({ page }) => {
    await expect(page.getByText('Balance blocked')).toBeVisible();
    await expect(page.getByText('Proof of delivery is pending, not approved')).toBeVisible();
    await expect(page.getByText('Approving the proof of delivery is what unblocks it.')).toBeVisible();
  });

  test('the tab strip navigates through documents, charges and the lorry receipt', async ({ page }) => {
    await page.getByRole('link', { name: 'Documents' }).click();
    await expect(page).toHaveURL(/\/trips\/t-120881\/documents$/);
    await expect(page.getByRole('heading', { name: 'Trip documents' })).toBeVisible();

    await page.getByRole('link', { name: 'Charges' }).click();
    await expect(page).toHaveURL(/\/trips\/t-120881\/charges$/);
    await expect(page.getByRole('heading', { name: 'Charges', exact: true })).toBeVisible();

    await page.getByRole('link', { name: 'Lorry receipt' }).click();
    await expect(page).toHaveURL(/\/trips\/t-120881\/lr$/);

    await page.getByRole('link', { name: 'Details' }).click();
    await expect(page).toHaveURL(/\/trips\/t-120881$/);
  });
});

test.describe('trip detail sub-pages — TRP-120881 (OPS)', () => {
  test('documents page groups the eleven-document set with per-group verified counts', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips/t-120881/documents');
    await expect(page.getByText('Waiting on e-way bill')).toBeVisible();

    await expect(panel(page, 'Client').getByText('1 of 2 verified')).toBeVisible();
    await expect(panel(page, 'Vehicle').getByText('4 of 5 verified')).toBeVisible();
    await expect(panel(page, 'Driver').getByText('0 of 1 verified')).toBeVisible();
    await expect(panel(page, 'Lorry receipt').getByText('1 of 1 verified')).toBeVisible();
    await expect(panel(page, 'Proof of delivery').getByText('0 of 1 verified')).toBeVisible();
  });

  test('charges page lists the captured charge, its markup and the totals', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips/t-120881/charges');
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    // Below the 767px breakpoint DataTable's <td> switches to display:flex
    // for the mobile card layout (NFR-06), which drops the implicit ARIA
    // "cell" role browsers otherwise infer from table markup — match on the
    // data-label DataTable sets on every cell instead, which is stable on
    // both layouts. (The capture form below also has an "loading" <option>,
    // so an unscoped text match is ambiguous.)
    await expect(page.locator('td[data-label="Charge"]')).toHaveText('loading');
    await expect(page.getByText('cost ₹1,800 · billed ₹2,200 · mark-up ₹400')).toBeVisible();
    // OPS has document.verify — the capture form is offered, not the hand-off note.
    await expect(page.getByRole('heading', { name: 'Capture a charge' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Capture' })).toBeVisible();
  });

  test('a trip with no captured charges shows the P&L-exception banner', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips/t-120874/charges');
    await expect(page.getByText('No charges captured on this trip')).toBeVisible();
    await expect(page.getByText('Nothing captured yet.')).toBeVisible();
  });

  test('lorry receipt page shows the issued LR read-only, with print/share controls', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips/t-120881/lr');
    await expect(page.getByRole('heading', { name: 'LR-88214', exact: true })).toBeVisible();
    await expect(page.getByText('in transit')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Print' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Share with transporter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate LR' })).toHaveCount(0);
  });
});

test.describe('trip detail — TRP-120855 (fully cleared money gates)', () => {
  test('advance already released and balance ready to release, both read-only for OPS', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips/t-120855');

    await expect(page.getByText('Advance released', { exact: true })).toBeVisible();
    await expect(page.getByText('40% of ₹29,400')).toBeVisible();

    await expect(page.getByText('Balance ready to release')).toBeVisible();
    const workings = panel(page, 'What reaches the transporter');
    await expect(workings.getByText('Net payable')).toBeVisible();
    await expect(workings.getByText('₹19,040')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Release/ })).toHaveCount(0);
  });

  test('a placed but not-yet-issued trip offers Generate LR to OPS', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/trips/t-120855/lr');
    await expect(page.getByRole('heading', { name: 'Lorry receipt — draft' })).toBeVisible();
    await expect(page.getByText('Autosaves every three seconds')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate LR' })).toBeEnabled();
  });

  test('FINANCE sees the read-only badge, can release the cleared balance, and cannot capture charges', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/trips/t-120855');
    await expect(page.getByTestId('view-only')).toBeVisible();

    // payment.release is granted to FINANCE independent of module-level VIEW access.
    const releaseButton = page.getByRole('button', { name: 'Release ₹19,040' });
    await expect(releaseButton).toBeVisible();
    await expect(releaseButton).toBeEnabled();

    await page.getByRole('link', { name: 'Charges' }).click();
    await expect(page).toHaveURL(/\/trips\/t-120855\/charges$/);
    await expect(page.getByText('Charges are captured at POD verification by branch or compliance.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Capture' })).toHaveCount(0);
  });
});
