import { Page, test, expect } from '@playwright/test';
import { setRole, statValue } from './helpers';

/**
 * Demand · RFQ — `/rfq`, `/rfq/[id]`, lane sourcing/build-up, and the award
 * screen (part 09).
 *
 * Fixture data (src/mocks/db.ts `db.rfqs`): rfq-1 is Berger Paints, status
 * SOURCING, two priced lanes (rl-11 Kolkata → Nashik monthly-sourced,
 * rl-12 Kolkata → Guwahati high/low-sourced). rfq-2 is Apex Ceramics,
 * status SUBMITTED, one lane (rl-21 Mundra → Jaipur) ready to award.
 * `rfq.edit` (EDIT) is seeded to OPS and LEADERSHIP;
 * COMPLIANCE and FINANCE hold VIEW. `rfq.submit` is LEADERSHIP-only (fixed).
 */

/** `Field` has no `htmlFor`/`id` — reach the control via the label's `div.field`. */
function fieldControl(page: Page, label: string) {
  return page
    .locator('div.field')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('input, select');
}

/** `StatStrip` renders `[eyebrow div][value div]` as flex siblings. */

/** A `Panel` with a heading — scopes queries to just that card. */
function panelByHeading(page: Page, heading: string) {
  return page.locator('div.surface').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
}

test.describe('RFQ list', () => {
  test('renders the seeded rows and the win-rate stats', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/rfq');

    await expect(statValue(page, 'rfq-live')).toHaveText('2');
    await expect(statValue(page, 'rfq-pricing')).toHaveText('3');
    await expect(statValue(page, 'rfq-won')).toHaveText('0');
    await expect(statValue(page, 'rfq-lost')).toHaveText('0');
    await expect(statValue(page, 'rfq-win-rate')).toHaveText('0.0%');
    await expect(statValue(page, 'rfq-value-won')).toHaveText('₹0');

    const row1 = page.locator('tr', { has: page.getByText('BRG/RFQ/27') });
    await expect(row1.locator('td[data-label="Client"]')).toHaveText('Berger Paints');
    await expect(row1.locator('td[data-label="Routes"]')).toHaveText('2');
    await expect(row1.getByText('SOURCING')).toBeVisible();

    const row2 = page.locator('tr', { has: page.getByText('APX/RFQ/H1') });
    await expect(row2.locator('td[data-label="Client"]')).toHaveText('Apex Ceramics');
    await expect(row2.locator('td[data-label="Routes"]')).toHaveText('1');
    await expect(row2.getByText('SUBMITTED')).toBeVisible();

    await expect(page.getByRole('link', { name: 'New RFQ' })).toBeVisible();
  });

  test('COMPLIANCE (VIEW-only) has no New RFQ control and is turned away from the create page', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/rfq');
    await expect(page.getByRole('link', { name: 'New RFQ' })).toHaveCount(0);

    await page.goto('/rfq/new');
    await expect(page.getByText('Creating an RFQ belongs to operations, branch management or leadership.')).toBeVisible();
    await expect(page.locator('main select')).toHaveCount(0);
  });
});

test.describe('RFQ detail — lane rendering', () => {
  test('a SOURCING rfq renders its priced lanes and the add-lane form', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/rfq/rfq-1');

    await expect(page.getByRole('heading', { name: 'Berger Paints · BRG/RFQ/27' })).toBeVisible();
    await expect(page.getByText('SOURCING', { exact: true })).toBeVisible();

    const laneRow = page.locator('tr', { has: page.getByText('Kolkata → Nashik') });
    await expect(laneRow.locator('td[data-label="Truck type"]')).toHaveText('32 ft SXL');
    await expect(laneRow.locator('td[data-label="Transit"]')).toHaveText('5d');
    await expect(laneRow.locator('td[data-label="Sourcing"]')).toHaveText('MONTHLY');
    await expect(laneRow.locator('td[data-label="Sourcing avg"]')).toHaveText('₹57,233');
    await expect(laneRow.locator('td[data-label="Overhead"]')).toHaveText('₹2,100');
    await expect(laneRow.locator('td[data-label="Margin"]')).toHaveText('₹4,800');
    await expect(laneRow.locator('td[data-label="Quoted rate"]')).toHaveText('₹64,133');

    const laneRow2 = page.locator('tr', { has: page.getByText('Kolkata → Guwahati') });
    await expect(laneRow2.locator('td[data-label="Sourcing"]')).toHaveText('HIGH/LOW');
    await expect(laneRow2.locator('td[data-label="Sourcing avg"]')).toHaveText('₹35,500');
    await expect(laneRow2.locator('td[data-label="Quoted rate"]')).toHaveText('₹38,600');

    await expect(page.getByRole('link', { name: 'Sourcing' })).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Build-up' })).toHaveCount(2);

    await expect(page.getByRole('heading', { name: 'Add a lane' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Submit to client' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Record award' })).toHaveCount(0);
  });

  test('a SUBMITTED rfq hides the add-lane form and offers Record award', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/rfq/rfq-2');

    await expect(page.getByText('SUBMITTED', { exact: true })).toBeVisible();
    await expect(page.getByText('Mundra → Jaipur')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add a lane' })).toHaveCount(0);

    const award = page.getByRole('link', { name: 'Record award' });
    await expect(award).toBeVisible();
    await expect(award).toHaveAttribute('href', '/rfq/rfq-2/award');
  });
});

test.describe('lane sourcing and quote build-up', () => {
  test('sourcing page renders the seeded monthly rates and their average', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/rfq/rfq-1/lanes/rl-11/sourcing');

    await expect(page.getByRole('heading', { name: 'Kolkata → Nashik' })).toBeVisible();
    await expect(page.getByText('MONTHLY', { exact: true })).toBeVisible();

    await expect(fieldControl(page, '2026-03')).toHaveValue('56200');
    await expect(fieldControl(page, '2026-04')).toHaveValue('57100');
    await expect(fieldControl(page, '2026-05')).toHaveValue('58400');

    await expect(page.getByText('Average', { exact: true }).locator('xpath=following-sibling::span[1]')).toHaveText(
      '₹57,233',
    );
    await expect(page.getByRole('button', { name: 'Save and build the quote' })).toBeEnabled();
  });

  test('quote build-up page derives the quoted rate and flags a below-minimum margin', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/rfq/rfq-1/lanes/rl-11/quote');

    await expect(page.getByRole('heading', { name: 'Kolkata → Nashik' })).toBeVisible();

    // 480,000 / 6,413,333 ≈ 7.5% margin — below the seeded 8% minimum.
    await expect(
      page.getByText('Margin is 7.5% — below the configured minimum of 8%'),
    ).toBeVisible();

    await expect(fieldControl(page, 'Average sourcing rate (₹)')).toHaveValue('57233.33');
    await expect(fieldControl(page, 'Overhead (₹)')).toHaveValue('2100');
    await expect(fieldControl(page, 'Margin (₹)')).toHaveValue('4800');
    await expect(fieldControl(page, 'Quoted rate (₹)')).toHaveValue('64133.33');

    await expect(page.getByText('Sourcing ₹57,233')).toBeVisible();
    await expect(page.getByText('Overhead ₹2,100')).toBeVisible();
    await expect(page.getByText('Margin ₹4,800')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save build-up' })).toBeEnabled();
  });
});

test.describe('award', () => {
  test('awarding the lane WON creates a rate card line and moves the rfq to AWARDED', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/rfq/rfq-2/award');

    await expect(page.getByRole('heading', { name: 'Record the award' })).toBeVisible();

    const laneRow = page.locator('tr', { has: page.getByText('Mundra → Jaipur') });
    await expect(laneRow.locator('td[data-label="We quoted"]')).toHaveText('₹52,100');
    await expect(laneRow.locator('select')).toHaveValue('WON');
    await expect(laneRow.locator('input[type="number"]')).toHaveValue('52100');

    const preview = panelByHeading(page, 'Rate card lines that will be created');
    await expect(preview.getByText('Mundra → Jaipur')).toBeVisible();
    await expect(preview.getByText('₹52,100')).toBeVisible();
    await expect(preview.getByText('rl-21')).toBeVisible();
    await expect(page.getByText('Every line carries its RFQ lane')).toBeVisible();

    await page.getByRole('button', { name: 'Create rate cards' }).click();

    await expect(page.getByText('1 rate card lane(s) created')).toBeVisible();
    await expect(page).toHaveURL(/\/rfq\/rfq-2$/);
    await expect(page.getByText('AWARDED', { exact: true })).toBeVisible();
    const awardedLane = page.locator('tr', { has: page.getByText('Mundra → Jaipur') });
    await expect(awardedLane.getByText('WON', { exact: true })).toBeVisible();
  });
});

test('OPS can create an RFQ, source a lane, build its quote, and hits the LEADERSHIP-only submit gate', async ({
  page,
}) => {
  await setRole(page, 'OPS');
  await page.goto('/rfq/new');

  await page.locator('main select').first().selectOption({ label: 'Sanghvi Metals' });
  await fieldControl(page, 'Period from').fill('2027-01-01');
  await fieldControl(page, 'Submission due').fill('2026-12-15');
  await expect(page.getByRole('button', { name: 'Create RFQ' })).toBeEnabled();
  await page.getByRole('button', { name: 'Create RFQ' }).click();

  await expect(page.getByText('RFQ created')).toBeVisible();
  await expect(page).toHaveURL(/\/rfq\/rfq-\d+$/);
  await expect(page.getByText('No lanes yet.')).toBeVisible();

  // Add a lane — status moves DRAFT → SOURCING.
  await fieldControl(page, 'Origin').fill('Mumbai');
  await fieldControl(page, 'Destination').fill('Delhi');
  await fieldControl(page, 'Truck type').fill('32 ft SXL');
  await page.getByRole('button', { name: 'Add lane' }).click();
  await expect(page.getByText('Mumbai → Delhi added')).toBeVisible();
  await expect(page.getByText('SOURCING', { exact: true })).toBeVisible();

  // Fill sourcing rates for the new lane — three MONTHLY fields, positional
  // (the month labels are computed from today's date, so match by position
  // within the "Rate per month" panel rather than by label text).
  await page.getByRole('link', { name: 'Sourcing' }).click();
  await expect(page.getByRole('heading', { name: 'Mumbai → Delhi' })).toBeVisible();
  const monthInputs = panelByHeading(page, 'Rate per month').locator('input[type="number"]');
  await expect(monthInputs).toHaveCount(3);
  await monthInputs.nth(0).fill('50000');
  await monthInputs.nth(1).fill('51000');
  await monthInputs.nth(2).fill('52000');
  await expect(page.getByText('Average', { exact: true }).locator('xpath=following-sibling::span[1]')).toHaveText(
    '₹51,000',
  );
  await page.getByRole('button', { name: 'Save and build the quote' }).click();
  await expect(page.getByText('Sourcing average ₹51,000')).toBeVisible();

  // Build the quote — sourcing avg + overhead + margin, status → QUOTED.
  await expect(page.getByRole('heading', { name: 'Mumbai → Delhi' })).toBeVisible();
  await fieldControl(page, 'Overhead (₹)').fill('2000');
  await fieldControl(page, 'Margin (₹)').fill('5000');
  await expect(fieldControl(page, 'Quoted rate (₹)')).toHaveValue('58000');
  // 5,000 / 58,000 ≈ 8.6% — above the seeded 8% minimum, so no warning banner.
  await expect(page.getByText(/below the configured minimum/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Save build-up' }).click();
  await expect(page.getByText('Quoted rate ₹58,000')).toBeVisible();

  // Back on the detail page: status QUOTED, but OPS lacks `rfq.submit`
  // (LEADERSHIP-only, fixed) — the submit control is withheld, not disabled.
  await expect(page).toHaveURL(/\/rfq\/rfq-\d+$/);
  await expect(page.getByText('QUOTED', { exact: true })).toBeVisible();
  await expect(page.getByText('Only LEADERSHIP may submit')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit to client' })).toHaveCount(0);
  const newLaneRow = page.locator('tr', { has: page.getByText('Mumbai → Delhi') });
  await expect(newLaneRow.locator('td[data-label="Quoted rate"]')).toHaveText('₹58,000');
});
