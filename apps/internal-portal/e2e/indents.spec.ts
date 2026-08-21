import { Page, test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Demand · Indents — `/indents`, `/indents/new`, `/indents/[id]` (part 04).
 *
 * Fixture data (src/mocks/db.ts `db.indents`): four seeded indents —
 * IND-4471 (Sanghvi Metals, OPEN, SPOT, 3 quotes), IND-4468 (Berger Paints,
 * OPEN, failureCause ONLY_ABOVE_BAND_QUOTES, 1 quote), IND-4462 (Apex
 * Ceramics, OPEN, 0 quotes), IND-4443 (Berger Paints, TRIP_CREATED, 0
 * quotes, buy rate already written). `indent.create` (EDIT) is seeded to
 * OPS and BRANCH_MGR only; COMPLIANCE, FINANCE and LEADERSHIP hold VIEW.
 */

/** The `Field` wrapper has no `htmlFor`/`id`, so getByLabel can't reach the
 * control — locate the `div.field` that contains the exact label text instead. */
function fieldControl(page: Page, label: string) {
  return page
    .locator('div.field')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('input, select');
}

function fieldError(page: Page, label: string) {
  return page
    .locator('div.field')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('.err');
}

/** `FactList` renders `[label span][value span]` as flex siblings. */
function factValue(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator('xpath=following-sibling::span[1]');
}

test.describe('indents list', () => {
  test('renders the seeded rows and the stage filter narrows them', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/indents');

    await expect(page.getByRole('link', { name: 'IND-4471' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'IND-4468' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'IND-4462' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'IND-4443' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Raise an indent' })).toBeVisible();

    // failureCause renders as a red tag next to the stage tag.
    await expect(page.getByText('only above band quotes')).toBeVisible();

    const stageFilter = page.locator('main select');
    await stageFilter.selectOption('OPEN');
    await expect(page.getByRole('link', { name: 'IND-4471' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'IND-4468' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'IND-4462' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'IND-4443' })).toHaveCount(0);

    await stageFilter.selectOption('TRIP_CREATED');
    await expect(page.getByRole('link', { name: 'IND-4443' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'IND-4471' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'IND-4468' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'IND-4462' })).toHaveCount(0);
  });

  test('FINANCE (VIEW-only) sees the read-only badge, no create control, and a guarded new-indent page', async ({
    page,
  }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/indents');

    await expect(page.getByText('Read-only for FINANCE')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Raise an indent' })).toHaveCount(0);

    await page.goto('/indents/new');
    await expect(page.getByText('is not held by your role')).toBeVisible();
    await expect(page.locator('input[name="fromCity"]')).toHaveCount(0);
  });
});

test.describe('raise an indent', () => {
  test('submitting the form empty surfaces required-field errors and does not navigate away', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/indents/new');

    await page.getByRole('button', { name: 'Raise indent' }).click();

    await expect(fieldError(page, 'Client')).toHaveText('Required');
    await expect(fieldError(page, 'Pickup city')).toHaveText('Required');
    await expect(fieldError(page, 'Delivery city')).toHaveText('Required');
    await expect(fieldError(page, 'Material')).toHaveText('Required');
    await expect(fieldError(page, 'Truck type')).toHaveText('Required');
    await expect(fieldError(page, 'Pickup date')).toHaveText('Required');
    // Numeric fields (weight, freight) go through valueAsNumber → NaN on an
    // empty input, so zod's message differs from the string fields' — just
    // confirm an error surfaced at all rather than assume the exact text.
    await expect(fieldError(page, 'Weight (MT)')).not.toHaveText('');
    await expect(fieldError(page, 'Freight to client (₹)')).not.toHaveText('');

    await expect(page).toHaveURL(/\/indents\/new$/);
  });

  test('a spot indent is blocked until the client rate approval is attached (BR-26/BR-38)', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/indents/new');

    await page.locator('select[name="clientId"]').selectOption({ label: 'Sanghvi Metals · SPOT' });
    await page.locator('input[name="fromCity"]').fill('Nashik');
    await page.locator('input[name="toCity"]').fill('Pune');
    await page.locator('input[name="material"]').fill('Steel coil');
    await page.locator('input[name="weightTn"]').fill('10');
    await page.locator('input[name="truckType"]').fill('32 ft SXL');
    await page.locator('input[name="pickupDate"]').fill('2026-09-01');
    await page.locator('select[name="rateSource"]').selectOption('SPOT');
    await page.locator('input[name="sourcingRupees"]').fill('30000');
    await page.locator('input[name="sellRupees"]').fill('35000');

    // Positive margin banner, but the raise button stays disabled without
    // the client's written rate approval attached.
    await expect(page.getByText('Margin ₹5,000')).toBeVisible();
    await expect(page.getByText('14.3% over the sourcing rate')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Raise indent' })).toBeDisabled();
    await expect(page.getByText('written rate approval first')).toBeVisible();

    await page.getByRole('button', { name: 'Attach client rate approval' }).click();
    await expect(page.getByText('Client rate approval attached')).toBeVisible();
    await expect(page.getByText('Rate approval attached', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Raise indent' })).toBeEnabled();
  });

  test('a valid contract indent is created and lands on its detail page', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/indents/new');

    await page.locator('select[name="clientId"]').selectOption({ label: 'Berger Paints · CONTRACT' });
    await page.locator('input[name="fromCity"]').fill('Nashik');
    await page.locator('input[name="toCity"]').fill('Surat');
    await page.locator('input[name="material"]').fill('Cotton bales');
    await page.locator('input[name="weightTn"]').fill('12');
    await page.locator('input[name="truckType"]').fill('32 ft SXL');
    await page.locator('input[name="pickupDate"]').fill('2026-09-10');
    // rateSource stays CONTRACT (default) — no sourcing rate/attachment needed.
    await page.locator('input[name="sellRupees"]').fill('40000');

    await page.getByRole('button', { name: 'Raise indent' }).click();

    await expect(page).toHaveURL(/\/indents\/i-\d+$/);
    await expect(page.getByRole('heading', { name: 'IND-04472' })).toBeVisible();

    await expect(factValue(page, 'Client')).toHaveText('Berger Paints');
    await expect(factValue(page, 'Branch')).toHaveText('Nashik');
    await expect(factValue(page, 'Material')).toHaveText('Cotton bales');
    await expect(factValue(page, 'Truck type')).toHaveText('32 ft SXL');
    await expect(factValue(page, 'Weight')).toHaveText('12 MT');
    await expect(factValue(page, 'Rate source')).toHaveText('CONTRACT');
    await expect(factValue(page, 'Client sell rate')).toHaveText('₹40,000');
    await expect(factValue(page, 'Buy rate')).toHaveText('not yet awarded');
  });
});

test.describe('indent detail', () => {
  test('renders progress, pricing and the quotes table for a seeded indent', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/indents/i-4471');

    await expect(page.getByRole('heading', { name: 'IND-4471' })).toBeVisible();
    await expect(page.getByText(/Bhiwandi.*Hyderabad.*32 ft SXL.*21 MT/)).toBeVisible();

    await expect(factValue(page, 'Client')).toHaveText('Sanghvi Metals');
    await expect(factValue(page, 'Branch')).toHaveText('Vijayawada');
    await expect(factValue(page, 'Distance')).toHaveText('712 km');
    await expect(factValue(page, 'Rate source')).toHaveText('SPOT');
    await expect(factValue(page, 'Client sell rate')).toHaveText('₹46,800');
    await expect(factValue(page, 'Sourcing rate')).toHaveText('₹40,200');
    await expect(factValue(page, 'Band')).toHaveText(/₹38,000.*42,500/);
    await expect(factValue(page, 'Buy rate')).toHaveText('not yet awarded');

    // Three quotes, cheapest first: two PENDING_VERIFICATION vendors that
    // cannot be awarded, one ACTIVE vendor above the published band.
    await expect(page.getByRole('link', { name: 'Rathod Roadlines' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sai Kripa Carriers' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bhagwati Logistics' })).toBeVisible();
    await expect(page.getByText('Vendor not cleared (BR-01)')).toHaveCount(2);
    await expect(page.getByText('In band', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Out of band', { exact: true })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Request approval' })).toBeVisible();
  });

  test('requesting an above-band award sends it to LEADERSHIP and flags the row', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/indents/i-4471');

    await page.getByRole('button', { name: 'Request approval' }).click();

    await expect(page.getByText('Sent to LEADERSHIP · above band by ₹2,000')).toBeVisible();
    await expect(page.getByText('Awaiting approval')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request approval' })).toHaveCount(0);
  });
});
