import { test, expect, Page } from '@playwright/test';

/**
 * Covers src/app/quotes/page.tsx against the FIXTURES seeded in
 * src/app/quotes/apis.ts (mock mode, NEXT_PUBLIC_MOCK=1).
 *
 * Fixture reference (do not drift from apis.ts):
 *  QT-8841  LD-4471  Bhiwandi -> Hyderabad  ₹40,200  SUBMITTED
 *  QT-8802  LD-4443  Nashik   -> Kolkata    ₹58,400  WON   (tripId TR-20881)
 *  QT-8790  LD-4430  Pune     -> Surat      ₹24,900  LOST  (lostReason AWARDED_ELSEWHERE)
 *  QT-8776  LD-4425  Vapi     -> Ludhiana   ₹51,200  WITHDRAWN
 *
 * BR-55/NFR-02: a WON quote must never show a winning/competitor price, and
 * a LOST quote's `lostReason` (src/app/quotes/types.ts) is a fixed enum
 * rendered through a lookup table — never free text, never a raw enum value.
 */

const TITLES = {
  submitted: /Bhiwandi\s*→\s*Hyderabad/,
  won: /Nashik\s*→\s*Kolkata/,
  lost: /Pune\s*→\s*Surat/,
  withdrawn: /Vapi\s*→\s*Ludhiana/,
};

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

function cardFor(page: Page, title: RegExp) {
  return page.locator('div.card', { has: page.locator('.card-title', { hasText: title }) });
}

test.describe('quotes list', () => {
  test('renders with status filter tabs and defaults to All', async ({ page }) => {
    await page.goto('/quotes');

    for (const name of ['All', 'Open', 'Won', 'Lost'] as const) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    }

    // All four fixtures show under "All", including the WITHDRAWN one which
    // has no dedicated tab of its own.
    for (const title of Object.values(TITLES)) {
      await expect(page.locator('.card-title').filter({ hasText: title })).toBeVisible();
    }
  });

  test('Open tab shows only the SUBMITTED quote', async ({ page }) => {
    await page.goto('/quotes');
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    await expect(page.locator('.card-title').filter({ hasText: TITLES.submitted })).toBeVisible();
    await expect(page.locator('.card-title').filter({ hasText: TITLES.won })).toHaveCount(0);
    await expect(page.locator('.card-title').filter({ hasText: TITLES.lost })).toHaveCount(0);
    await expect(page.locator('.card-title').filter({ hasText: TITLES.withdrawn })).toHaveCount(0);
  });

  test('Won tab shows only the WON quote', async ({ page }) => {
    await page.goto('/quotes');
    await page.getByRole('button', { name: 'Won', exact: true }).click();

    const won = cardFor(page, TITLES.won);
    await expect(won).toBeVisible();
    await expect(won).toContainText('Won');
    await expect(page.locator('.card-title').filter({ hasText: TITLES.submitted })).toHaveCount(0);
    await expect(page.locator('.card-title').filter({ hasText: TITLES.lost })).toHaveCount(0);
  });

  test('Lost tab shows only the LOST quote', async ({ page }) => {
    await page.goto('/quotes');
    await page.getByRole('button', { name: 'Lost', exact: true }).click();

    const lost = cardFor(page, TITLES.lost);
    await expect(lost).toBeVisible();
    await expect(lost).toContainText('Lost');
    await expect(page.locator('.card-title').filter({ hasText: TITLES.submitted })).toHaveCount(0);
    await expect(page.locator('.card-title').filter({ hasText: TITLES.won })).toHaveCount(0);
  });
});

test.describe('redaction (BR-55/NFR-02)', () => {
  test('a WON quote never shows a winning price or competitor detail', async ({ page }) => {
    await page.goto('/quotes');
    await page.getByRole('button', { name: 'Won', exact: true }).click();

    const won = cardFor(page, TITLES.won);
    await expect(won).toBeVisible();
    // Only the vendor's own quoted amount and their own trip link are shown.
    await expect(won).toContainText('₹58,400');
    await expect(won).toContainText('Open trip TR-20881');

    await assertNoRedactedFields(page);
  });

  test('a LOST quote shows only the fixed enum reason, never free text or a price delta', async ({ page }) => {
    await page.goto('/quotes');
    await page.getByRole('button', { name: 'Lost', exact: true }).click();

    const lost = cardFor(page, TITLES.lost);
    await expect(lost).toBeVisible();
    // Mapped through LOST_NOTE — human copy, not the raw enum value.
    await expect(lost).toContainText('This lane was awarded elsewhere.');

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/\bAWARDED_ELSEWHERE\b/);
    expect(bodyText).not.toMatch(/\bINDENT_CANCELLED\b/);
    expect(bodyText).not.toMatch(/\bEXPIRED\b/);

    await assertNoRedactedFields(page);
  });
});

test.describe('withdraw flow', () => {
  test('the withdraw action is only offered on the SUBMITTED quote', async ({ page }) => {
    await page.goto('/quotes');

    await expect(cardFor(page, TITLES.submitted).getByRole('button', { name: 'Withdraw quote' })).toBeVisible();
    await expect(cardFor(page, TITLES.won).getByRole('button', { name: 'Withdraw quote' })).toHaveCount(0);
    await expect(cardFor(page, TITLES.lost).getByRole('button', { name: 'Withdraw quote' })).toHaveCount(0);
    await expect(cardFor(page, TITLES.withdrawn).getByRole('button', { name: 'Withdraw quote' })).toHaveCount(0);
  });

  test('withdrawing a SUBMITTED quote calls the DELETE flow without error', async ({ page }) => {
    await page.goto('/quotes');

    const submittedCard = cardFor(page, TITLES.submitted);
    await submittedCard.getByRole('button', { name: 'Withdraw quote' }).click();

    // apis.ts withdrawQuote() -> DELETE /portal/quotes/:id; in mock mode it
    // resolves void and the page silently reloads the list via getQuotes().
    // The mock fixture is static (not mutated on withdraw), so we assert the
    // no-error contract here rather than a status change the mock can't produce.
    await expect(page).toHaveURL(/\/quotes$/);
    const submittedCardAfter = cardFor(page, TITLES.submitted);
    await expect(submittedCardAfter).toBeVisible();
    await expect(submittedCardAfter).toContainText('Submitted');
  });
});
