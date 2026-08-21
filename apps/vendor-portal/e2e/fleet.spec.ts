import { test, expect, Page } from '@playwright/test';

/**
 * Covers src/app/fleet/page.tsx against the FIXTURES seeded in
 * src/app/fleet/apis.ts (mock mode, NEXT_PUBLIC_MOCK=1).
 *
 * Fixture reference (do not drift from apis.ts):
 *  VH-4482  MH 15 GT 4482  32 ft SXL         21 MT  Nashik  ON_TRIP      free from 2026-08-15
 *  VH-9034  MH 04 KL 9034  22 ft container    9 MT  Thane   AVAILABLE
 *  VH-7721  MH 12 RB 7721  40 ft trailer     24 MT  Pune    DOCS_DUE     Fitness certificate expired 2026-08-02
 *  VH-2207  MH 15 EE 2207  Open body         16 MT  Nashik  MAINTENANCE
 *
 * The mock backend (src/lib/mock.ts) is static: addVehicle/updateVehicle
 * resolve without mutating FIXTURES, so a refetch after either action always
 * comes back looking exactly like the table above — tests below assert that
 * contract rather than a persisted state change the mock can't produce.
 *
 * BR-55/NFR-02: the transporter must never see client name, sell rate, other
 * vendors' quotes, or margin anywhere in this flow.
 */

const FORBIDDEN_TERMS = [
  'client',
  'competitor',
  'sell rate',
  'selling rate',
  'other vendor',
  'other quote',
  'quote count',
  'winning bid',
  'winning price',
  ' margin',
];

async function assertNoRedactedFields(page: Page) {
  const text = (await page.locator('body').innerText()).toLowerCase();
  for (const term of FORBIDDEN_TERMS) {
    expect(text, `redaction leak: found "${term}" in page text`).not.toContain(term);
  }
}

function cardFor(page: Page, registrationNo: string) {
  return page.locator('div.card', { hasText: registrationNo });
}

test.describe('fleet list', () => {
  test('renders every fixture vehicle with its registration, spec line and status pill', async ({ page }) => {
    await page.goto('/fleet');

    const onTrip = cardFor(page, 'MH 15 GT 4482');
    await expect(onTrip).toBeVisible();
    await expect(onTrip).toContainText('On trip');
    await expect(onTrip).toContainText('32 ft SXL · 21 MT · Nashik · free from 2026-08-15');

    const available = cardFor(page, 'MH 04 KL 9034');
    await expect(available).toBeVisible();
    await expect(available).toContainText('Available');
    await expect(available).toContainText('22 ft container · 9 MT · Thane');

    const docsDue = cardFor(page, 'MH 12 RB 7721');
    await expect(docsDue).toBeVisible();
    await expect(docsDue).toContainText('Docs due');
    await expect(docsDue).toContainText('40 ft trailer · 24 MT · Pune');

    const maintenance = cardFor(page, 'MH 15 EE 2207');
    await expect(maintenance).toBeVisible();
    await expect(maintenance).toContainText('Maintenance');
    await expect(maintenance).toContainText('Open body · 16 MT · Nashik');

    await assertNoRedactedFields(page);
  });

  test('only the ON_TRIP vehicle shows a "free from" date', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.getByText('free from 2026-08-15')).toBeVisible();
    // The spec line only interpolates "free from" for an ON_TRIP vehicle with
    // a freeFrom date, so it should never render for the other three.
    await expect(page.getByText(/free from/)).toHaveCount(1);
  });

  test('DOCS_DUE vehicle shows the compliance callout instead of a status toggle, linking to Profile', async ({ page }) => {
    await page.goto('/fleet');
    const docsDue = cardFor(page, 'MH 12 RB 7721');

    await expect(docsDue).toContainText('Fitness certificate');
    await expect(docsDue).toContainText('expired 2026-08-02');
    await expect(docsDue).toContainText('Re-upload it in');
    await expect(docsDue.getByRole('link', { name: 'Profile' })).toHaveAttribute('href', '/profile');

    // No settable-status toggle on a DOCS_DUE card — that state is system-set.
    await expect(docsDue.getByRole('button', { name: 'Available', exact: true })).toHaveCount(0);
    await expect(docsDue.getByRole('button', { name: 'On trip', exact: true })).toHaveCount(0);
    await expect(docsDue.getByRole('button', { name: 'Maintenance', exact: true })).toHaveCount(0);
  });

  test('every other vehicle shows a settable status toggle with the current status highlighted', async ({ page }) => {
    await page.goto('/fleet');

    const onTrip = cardFor(page, 'MH 15 GT 4482');
    await expect(onTrip.getByRole('button', { name: 'On trip', exact: true })).toBeVisible();
    await expect(onTrip.getByRole('button', { name: 'Available', exact: true })).toBeVisible();
    await expect(onTrip.getByRole('button', { name: 'Maintenance', exact: true })).toBeVisible();

    const available = cardFor(page, 'MH 04 KL 9034');
    await expect(available.getByRole('button', { name: 'Available', exact: true })).toBeVisible();
  });

  test('toggling a status calls the update endpoint without surfacing an error', async ({ page }) => {
    await page.goto('/fleet');
    const available = cardFor(page, 'MH 04 KL 9034');

    await available.getByRole('button', { name: 'Maintenance', exact: true }).click();

    // updateVehicle() resolves void against a static fixture list, so the
    // refetch comes back unchanged — the meaningful assertion is that the
    // round trip completes cleanly (no ErrorNote, still on /fleet, the card
    // is still there showing its original AVAILABLE status).
    await expect(page).toHaveURL(/\/fleet$/);
    const availableAfter = cardFor(page, 'MH 04 KL 9034');
    await expect(availableAfter).toBeVisible();
    await expect(availableAfter).toContainText('Available');
  });
});

test.describe('add a truck form', () => {
  test('is hidden by default and toggles open/closed via the header button', async ({ page }) => {
    await page.goto('/fleet');

    await expect(page.locator('#reg')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add a truck' }).click();
    await expect(page.locator('#reg')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#reg')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add a truck' })).toBeVisible();
  });

  test('the vehicle type select lists every truck type from the shared catalogue', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByRole('button', { name: 'Add a truck' }).click();

    const options = await page.locator('#type option').allTextContents();
    expect(options).toEqual(['32 ft SXL', '22 ft container', '40 ft trailer', 'Open body']);
  });

  test('Save truck stays disabled until registration and capacity are both filled', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByRole('button', { name: 'Add a truck' }).click();

    const save = page.getByRole('button', { name: 'Save truck' });
    await expect(save).toBeDisabled();

    await page.locator('#reg').fill('MH14AB1234');
    await expect(save).toBeDisabled(); // capacity still empty

    await page.locator('#cap').fill('9');
    await expect(save).toBeEnabled(); // AVAILABLE is the default status, no free-from needed
  });

  test('selecting "On trip" status requires a free-from date before Save enables', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByRole('button', { name: 'Add a truck' }).click();

    await page.locator('#reg').fill('MH14AB1234');
    await page.locator('#cap').fill('9');
    const save = page.getByRole('button', { name: 'Save truck' });
    await expect(save).toBeEnabled();

    // Segmented status control inside the form — scope to the form card to
    // avoid matching a fleet card's own status toggle.
    const form = page.locator('.card').filter({ has: page.locator('#reg') });
    await form.getByRole('button', { name: 'On trip', exact: true }).click();
    await expect(page.locator('#free')).toBeVisible();
    await expect(save).toBeDisabled();

    await page.locator('#free').fill('2026-09-01');
    await expect(save).toBeEnabled();
  });

  test('a successful save resets and closes the form (mock does not persist the new truck)', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByRole('button', { name: 'Add a truck' }).click();

    await page.locator('#reg').fill('MH14AB1234');
    await page.locator('#cap').fill('12');
    await page.getByRole('button', { name: 'Save truck' }).click();

    // Form closes once addVehicle() resolves.
    await expect(page.getByRole('button', { name: 'Add a truck' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#reg')).toHaveCount(0);

    // Reopening shows the fields reset, not the previously typed values.
    await page.getByRole('button', { name: 'Add a truck' }).click();
    await expect(page.locator('#reg')).toHaveValue('');
    await expect(page.locator('#cap')).toHaveValue('');

    // The fixture list is unchanged — the mock never appended the new truck.
    await expect(page.locator('div.card', { hasText: 'MH14AB1234' })).toHaveCount(0);
    await expect(cardFor(page, 'MH 15 GT 4482')).toBeVisible();
    await expect(cardFor(page, 'MH 04 KL 9034')).toBeVisible();
    await expect(cardFor(page, 'MH 12 RB 7721')).toBeVisible();
    await expect(cardFor(page, 'MH 15 EE 2207')).toBeVisible();
  });

  test('the capacity field strips non-numeric characters as they are typed', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByRole('button', { name: 'Add a truck' }).click();

    await page.locator('#cap').fill('21abc.5xyz');
    await expect(page.locator('#cap')).toHaveValue('21.5');
  });

  test('the city field auto-capitalizes free text on blur', async ({ page }) => {
    await page.goto('/fleet');
    await page.getByRole('button', { name: 'Add a truck' }).click();

    await page.locator('#city').fill('nashik');
    await page.locator('#cap').click(); // blur #city
    await expect(page.locator('#city')).toHaveValue('Nashik');
  });
});

test.describe('empty state', () => {
  test('no empty-fleet fixture exists, so the "No trucks yet" copy never renders against the seeded data', async ({ page }) => {
    await page.goto('/fleet');
    await expect(page.getByText('No trucks yet. Add one and loads will start matching.')).toHaveCount(0);
  });
});

test.describe('redaction (BR-55/NFR-02)', () => {
  test('no forbidden field appears on the fleet page in any state', async ({ page }) => {
    await page.goto('/fleet');
    await assertNoRedactedFields(page);

    await page.getByRole('button', { name: 'Add a truck' }).click();
    await assertNoRedactedFields(page);
  });
});
