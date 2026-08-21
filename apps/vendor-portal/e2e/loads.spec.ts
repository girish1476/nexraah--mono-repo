import { test, expect, Page } from '@playwright/test';

/**
 * Covers src/app/loads/page.tsx, src/app/loads/[code]/page.tsx and
 * src/app/loads/[code]/quote/page.tsx against the FIXTURES seeded in
 * src/app/loads/apis.ts (mock mode, NEXT_PUBLIC_MOCK=1).
 *
 * Fixture reference (do not drift from apis.ts):
 *  LD-4471  Bhiwandi -> Hyderabad   32 ft SXL         band 3,800,000-4,250,000p (₹38,000-₹42,500)
 *  LD-4468  Chakan   -> Coimbatore  22 ft container   band 2,950,000-3,300,000p (₹29,500-₹33,000)
 *  LD-4462  Mundra   -> Jaipur      40 ft trailer     band 4,700,000-5,200,000p (₹47,000-₹52,000)
 *  LD-4459  Hosur    -> Gurugram    32 ft SXL         band 6,100,000-6,750,000p (₹61,000-₹67,500)
 *
 * BR-55/NFR-02: the vendor must never see client name, sell rate, other
 * vendors' quotes/prices, or margin anywhere in this flow.
 */

const FIXTURE_TITLES = [
  /Bhiwandi\s*→\s*Hyderabad/,
  /Chakan\s*→\s*Coimbatore/,
  /Mundra\s*→\s*Jaipur/,
  /Hosur\s*→\s*Gurugram/,
];

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

test.describe('loads list', () => {
  test('renders load cards from fixtures', async ({ page }) => {
    await page.goto('/loads');

    for (const title of FIXTURE_TITLES) {
      await expect(page.locator('.card-title').filter({ hasText: title })).toBeVisible();
    }

    // Band price + pill for the first fixture.
    const firstCard = page.locator('a.card', { has: page.locator('.card-title', { hasText: FIXTURE_TITLES[0] }) });
    await expect(firstCard).toContainText('₹38,000');
    await expect(firstCard).toContainText('₹42,500');
    await expect(firstCard).toContainText('Open');
    await expect(firstCard).toContainText('32 ft SXL');
    await expect(firstCard).toContainText('21 MT CR steel coils');
    await expect(firstCard).toContainText('712');

    await assertNoRedactedFields(page);
  });

  test('truck-type filter sheet toggles and filters correctly', async ({ page }) => {
    await page.goto('/loads');
    await expect(page.locator('.card-title').filter({ hasText: FIXTURE_TITLES[0] })).toBeVisible();

    const filterButton = page.getByRole('button', { name: 'Filters (0)' });
    await expect(filterButton).toBeVisible();
    await filterButton.click();

    // Sheet is open — the truck-type toggle buttons are visible.
    const containerToggle = page.getByRole('button', { name: '22 ft container', exact: true });
    await expect(containerToggle).toBeVisible();

    await containerToggle.click();
    await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible();

    // Only the "22 ft container" load (LD-4468, Chakan -> Coimbatore) remains.
    await expect(page.locator('.card-title').filter({ hasText: FIXTURE_TITLES[1] })).toBeVisible();
    await expect(page.locator('.card-title').filter({ hasText: FIXTURE_TITLES[0] })).toHaveCount(0);
    await expect(page.locator('.card-title').filter({ hasText: FIXTURE_TITLES[2] })).toHaveCount(0);
    await expect(page.locator('.card-title').filter({ hasText: FIXTURE_TITLES[3] })).toHaveCount(0);

    // Clearing filters brings every fixture back.
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.getByRole('button', { name: 'Filters (0)' })).toBeVisible();
    for (const title of FIXTURE_TITLES) {
      await expect(page.locator('.card-title').filter({ hasText: title })).toBeVisible();
    }
  });

  test('a truck type with no matching loads shows the empty state', async ({ page }) => {
    await page.goto('/loads');
    await page.getByRole('button', { name: 'Filters (0)' }).click();
    await page.getByRole('button', { name: 'Open body', exact: true }).click();

    await expect(page.getByText('No loads match those truck types right now.')).toBeVisible();
    for (const title of FIXTURE_TITLES) {
      await expect(page.locator('.card-title').filter({ hasText: title })).toHaveCount(0);
    }
  });

  test('clicking a load navigates to its detail page', async ({ page }) => {
    await page.goto('/loads');
    const card = page.locator('a.card', { has: page.locator('.card-title', { hasText: FIXTURE_TITLES[0] }) });
    await card.click();

    // Client-side transition into an on-demand-compiled dev route; give it
    // more headroom than the default 5s under parallel workers.
    await expect(page).toHaveURL(/\/loads\/LD-4471$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'LD-4471' })).toBeVisible();
  });
});

test.describe('load detail', () => {
  test('shows the correct fixture info for LD-4471', async ({ page }) => {
    await page.goto('/loads/LD-4471');

    await expect(page.getByRole('heading', { name: 'LD-4471' })).toBeVisible();
    await expect(page.getByText('Bhiwandi → Hyderabad')).toBeVisible();
    // The band range appears twice on this page (the Bid band card and the
    // ActionBar note) — scope to the Bid band card to keep the locator strict.
    const bidBandCard = page.locator('.card', { hasText: 'Bid band' });
    await expect(bidBandCard.getByText('₹38,000 – ₹42,500', { exact: true })).toBeVisible();

    await expect(page.getByText('32 ft SXL')).toBeVisible();
    await expect(page.getByText('21 MT')).toBeVisible();
    await expect(page.getByText('CR steel coils')).toBeVisible();
    await expect(page.getByText('712 km')).toBeVisible();
    await expect(page.getByText('2 days')).toBeVisible();
    await expect(page.getByText('Same day')).toBeVisible();
    await expect(page.getByText('40% of freight')).toBeVisible();
    await expect(page.getByText('Reporting 06:00 at the plant gate')).toBeVisible();

    await expect(page.getByRole('button', { name: /Quote this load/ })).toBeVisible();

    await assertNoRedactedFields(page);
  });

  test('an unknown load code shows an error, not a crash', async ({ page }) => {
    await page.goto('/loads/LD-0000');
    await expect(page.getByText('Load not found')).toBeVisible();
  });
});

test.describe('quote form (BR-05 band enforcement)', () => {
  test('a quote below the band minimum is blocked', async ({ page }) => {
    await page.goto('/loads/LD-4471');
    await page.getByRole('button', { name: /Quote this load/ }).click();
    // Client-side transition into an on-demand-compiled dev route; give it
    // more headroom than the default 5s under parallel workers.
    await expect(page).toHaveURL(/\/loads\/LD-4471\/quote$/, { timeout: 15_000 });

    const amount = page.locator('#amount');
    await expect(amount).toHaveValue('38000'); // defaults to the band floor
    await amount.fill('30000'); // below the 38,000 floor

    await expect(page.getByText('Below the band')).toBeVisible();
    await expect(
      page.getByText('Nexraah will not award this lane below ₹38,000'),
    ).toBeVisible();

    const submit = page.getByRole('button', { name: /Submit quote/ });
    await expect(submit).toBeDisabled();
    await expect(page.getByText('Blocked: below the published floor of ₹38,000')).toBeVisible();

    await assertNoRedactedFields(page);
  });

  test('a valid quote submission succeeds', async ({ page }) => {
    await page.goto('/loads/LD-4471/quote');

    const amount = page.locator('#amount');
    await amount.fill('40000'); // within the 38,000-42,500 band

    await expect(page.getByText('Within the band')).toBeVisible();

    // Wait for the vehicle list (mocked, async) to populate before submitting.
    await expect(page.locator('#vehicle option').first()).toBeAttached();

    const submit = page.getByRole('button', { name: /Submit quote ₹40,000/ });
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(page).toHaveURL(/\/quotes$/, { timeout: 15_000 });
  });

  test('an above-band quote is allowed but flagged for approval', async ({ page }) => {
    await page.goto('/loads/LD-4471/quote');

    const amount = page.locator('#amount');
    await amount.fill('43000'); // above the 42,500 ceiling

    await expect(page.getByText('Above the band')).toBeVisible();
    const submit = page.getByRole('button', { name: /Submit quote ₹43,000/ });
    await expect(submit).toBeEnabled();
    await expect(page.getByText('Will be sent for approval before award')).toBeVisible();

    await assertNoRedactedFields(page);
  });
});
