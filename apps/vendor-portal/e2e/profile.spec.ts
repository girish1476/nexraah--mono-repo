import { test, expect, Page } from '@playwright/test';

/**
 * Covers src/app/profile/page.tsx against the FIXTURE seeded in
 * src/app/profile/apis.ts (mock mode, NEXT_PUBLIC_MOCK=1).
 *
 * Fixture reference (do not drift from apis.ts):
 *  V-2214 "Rathod Roadlines" — Sandeep Rathod · 98220 41xx · Nashik
 *  GSTIN 27AABCR1234M1Z5 · PAN AABCR****M · Aadhaar ••••4471 · Bank ••••••7741 · SBIN0001234
 *  Advance policy 40% · business: 128 trips, ₹74,20,000 freight value, ₹53,360 outstanding
 *
 *  Identity — verified once, not per load
 *    PAN card photo            VERIFIED
 *    Aadhaar card photo        VERIFIED
 *    Geo-stamped selfie        VERIFIED
 *    Address proof             REJECTED  "Electricity bill is more than three months old." (2026-08-03)
 *  Company & banking
 *    Cancelled cheque          VERIFIED
 *    MSME certificate          PENDING
 *    Signed transporter agreement  MISSING
 *  Vehicle documents — these gate the advance
 *    Registration certificate  PENDING
 *    Fitness certificate       EXPIRED (2026-08-02) -> grounds MH 12 RB 7721 (fleet's DOCS_DUE vehicle)
 *    Insurance                 VERIFIED
 *    PUC certificate           VERIFIED
 *    Driving licence — Sandeep Rathod  MISSING
 *
 * BR-04/NFR-04: PAN, Aadhaar and bank account are always masked — the app
 * never has the unmasked value to leak, but every render must still use the
 * masked field, never a placeholder that could regress to raw digits.
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

function factRow(page: Page, label: string) {
  return page.locator('.row-between').filter({ has: page.locator('.muted', { hasText: label }) });
}

/**
 * A document row is `<div>{ .row-between (label + status pill) }{ optional
 * reason/expiry paragraph }{ optional upload button }</div>` — the reason
 * and the button are siblings of .row-between, not inside it, so scope to
 * the shared parent to reach all of it.
 */
function docRow(page: Page, label: string) {
  return page.locator('.row-between').filter({ hasText: label }).locator('xpath=..');
}

test.describe('profile fields', () => {
  test('header shows the company name and vendor code', async ({ page }) => {
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(page.getByText('Rathod Roadlines · vendor V-2214')).toBeVisible();
  });

  test('renders contact, city, GSTIN and advance policy facts from the fixture', async ({ page }) => {
    await page.goto('/profile');

    await expect(factRow(page, 'Contact')).toContainText('Sandeep Rathod · 98220 41xx');
    await expect(factRow(page, 'City')).toContainText('Nashik');
    await expect(factRow(page, 'GSTIN')).toContainText('27AABCR1234M1Z5');
    await expect(factRow(page, 'Advance policy')).toContainText('40% of freight');
  });

  test('PAN, Aadhaar and bank account render masked — never the unmasked form', async ({ page }) => {
    await page.goto('/profile');

    const pan = factRow(page, 'PAN');
    await expect(pan).toContainText('AABCR****M');

    const aadhaar = factRow(page, 'Aadhaar');
    await expect(aadhaar).toContainText('•••• •••• 4471');
    // Only the last 4 digits are ever shown — no other digit run appears.
    const aadhaarText = await aadhaar.innerText();
    expect(aadhaarText.replace(/[^0-9]/g, '')).toBe('4471');

    const bank = factRow(page, 'Bank account');
    await expect(bank).toContainText('••••••7741 · SBIN0001234');
    // The account number itself is masked to its last 4 digits; only the
    // IFSC (a public routing code, not an account secret) is shown in full.
    const bankText = await bank.innerText();
    expect(bankText).toContain('••••••7741');
    expect(bankText).not.toMatch(/\d{5,}7741/); // no longer, unmasked digit run

    await assertNoRedactedFields(page);
  });

  test('business stats render with correct Indian-format currency grouping', async ({ page }) => {
    await page.goto('/profile');

    const business = page.locator('.card', { hasText: 'Your business with us' });
    await expect(business).toContainText('Trips carried');
    await expect(business).toContainText('128');
    await expect(business).toContainText('₹74,20,000'); // freight value
    await expect(business).toContainText('₹53,360'); // outstanding to you
  });
});

test.describe('document groups', () => {
  test('renders all three document groups with their headings', async ({ page }) => {
    await page.goto('/profile');

    await expect(page.getByText('Identity — verified once, not per load')).toBeVisible();
    await expect(page.getByText('Company & banking')).toBeVisible();
    await expect(page.getByText('Vehicle documents — these gate the advance')).toBeVisible();
  });

  test('every fixture document renders with its correct status label', async ({ page }) => {
    await page.goto('/profile');

    await expect(docRow(page, 'PAN card photo')).toContainText('Verified');
    await expect(docRow(page, 'Aadhaar card photo')).toContainText('Verified');
    await expect(docRow(page, 'Geo-stamped selfie')).toContainText('Verified');
    await expect(docRow(page, 'Address proof')).toContainText('Rejected');
    await expect(docRow(page, 'Cancelled cheque')).toContainText('Verified');
    await expect(docRow(page, 'MSME certificate')).toContainText('With compliance'); // PENDING
    await expect(docRow(page, 'Signed transporter agreement')).toContainText('Not uploaded'); // MISSING
    await expect(docRow(page, 'Registration certificate')).toContainText('With compliance'); // PENDING
    await expect(docRow(page, 'Fitness certificate')).toContainText('Expired');
    await expect(docRow(page, 'Insurance')).toContainText('Verified');
    await expect(docRow(page, 'PUC certificate')).toContainText('Verified');
    await expect(docRow(page, 'Driving licence — Sandeep Rathod')).toContainText('Not uploaded'); // MISSING
  });

  test('a VERIFIED document offers no upload action', async ({ page }) => {
    await page.goto('/profile');
    const panRow = docRow(page, 'PAN card photo');
    await expect(panRow.getByRole('button')).toHaveCount(0);
  });

  test('the rejected Address proof shows its rejection date and reason', async ({ page }) => {
    await page.goto('/profile');
    const addressProof = docRow(page, 'Address proof');
    await expect(addressProof).toContainText(
      'Rejected 2026-08-03 — Electricity bill is more than three months old.',
    );
    await expect(addressProof.getByRole('button', { name: 'Re-upload' })).toBeVisible();
  });

  test('the expired Fitness certificate names the grounded vehicle, cross-referencing Fleet\'s DOCS_DUE vehicle', async ({ page }) => {
    await page.goto('/profile');
    const fitness = docRow(page, 'Fitness certificate');
    await expect(fitness).toContainText(
      'Expired 2026-08-02 · MH 12 RB 7721 is unavailable for new loads until this is renewed',
    );
    await expect(fitness.getByRole('button', { name: 'Re-upload — opens the camera' })).toBeVisible();
  });

  test('MISSING documents say "Upload"; PENDING/REJECTED/EXPIRED say "Re-upload", suffixed only when the document needs the camera', async ({ page }) => {
    await page.goto('/profile');

    // MISSING, capture=false.
    await expect(
      docRow(page, 'Signed transporter agreement').getByRole('button', { name: 'Upload', exact: true }),
    ).toBeVisible();
    // MISSING, capture=true.
    await expect(
      docRow(page, 'Driving licence — Sandeep Rathod').getByRole('button', { name: 'Upload — opens the camera' }),
    ).toBeVisible();
    // PENDING, capture=false.
    await expect(
      docRow(page, 'MSME certificate').getByRole('button', { name: 'Re-upload', exact: true }),
    ).toBeVisible();
    // PENDING, capture=true.
    await expect(
      docRow(page, 'Registration certificate').getByRole('button', { name: 'Re-upload — opens the camera' }),
    ).toBeVisible();
    // REJECTED, capture=false.
    await expect(
      docRow(page, 'Address proof').getByRole('button', { name: 'Re-upload', exact: true }),
    ).toBeVisible();
  });

  test('uploading against a MISSING document (no geotag needed) shows the confirmation flash', async ({ page }) => {
    await page.goto('/profile');

    // Scope to the Driving licence row specifically — a plain substring
    // match on "Upload — opens the camera" also matches every "Re-upload —
    // opens the camera" button (it's a substring of "Re-upload …").
    const row = docRow(page, 'Driving licence — Sandeep Rathod');
    const fileInput = row.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'dl.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('fixture-dl-bytes'),
    });

    await expect(page.getByText('Uploaded — sent to compliance for verification')).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe('redaction (BR-55/NFR-02)', () => {
  test('no forbidden field appears anywhere on the profile page', async ({ page }) => {
    await page.goto('/profile');
    await assertNoRedactedFields(page);
  });
});
