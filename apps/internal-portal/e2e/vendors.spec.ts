import { test, expect, Locator } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Vendor / supply side — `/vendors`, `/vendors/new`, `/vendors/[id]`,
 * `/vendors/leads`, `/vendors/market-gap`, `/vendors/issues`.
 *
 * Fixture data is `src/mocks/db.ts` — assertions below are pinned to the
 * seeded rows (VND-2214 Rathod Roadlines, VND-2287 Sai Kripa Carriers,
 * VND-2301 Bhagwati Logistics; leads LD-0084..0087; market-gap mg-1..4;
 * issues IS-0041..0043), not guesses.
 *
 * Role note (BR-29 vs SEED_GRANTS, `src/lib/permissions.ts`): the *module*
 * level for `vendors` gives COMPLIANCE `EDIT` and OPS `VIEW` — that governs
 * the view-only badge. But the onboarding action itself is gated
 * by the named permission `vendor.edit`, which SEED_GRANTS hands only to
 * OPS (mirrored in internal-api's `roles.constants.ts` and
 * `docs/specs/internal-spec/03-C2-vendors-compliance.md` §1). So OPS — not
 * COMPLIANCE — is the role that sees "Onboard a vendor": OPS captures the
 * file, COMPLIANCE only verifies and activates it.
 */

const field = (main: Locator, label: string): Locator =>
  main.locator('.field').filter({ has: main.page().getByText(label, { exact: true }) });

const panel = (main: Locator, title: string): Locator =>
  main.locator('.surface').filter({ has: main.page().getByRole('heading', { name: title, exact: true }) });

test.describe('Vendors — list', () => {
  test('renders the seeded vendor rows', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors');
    const main = page.locator('main');
    const rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(3);

    const rathod = rows.filter({ hasText: 'VND-2214' });
    await expect(rathod).toContainText('Rathod Roadlines');
    await expect(rathod).toContainText('Nashik');
    await expect(rathod).toContainText('9822014471');
    await expect(rathod).toContainText('14'); // fleet count
    await expect(rathod).toContainText('41'); // trips
    await expect(rathod).toContainText('₹2.4 L'); // margin, inrCompact(24100000)
    await expect(rathod).toContainText('40%');
    await expect(rathod).toContainText('Papers being checked');

    const saiKripa = rows.filter({ hasText: 'VND-2287' });
    await expect(saiKripa).toContainText('Sai Kripa Carriers');
    await expect(saiKripa).toContainText('Pune');
    await expect(saiKripa).toContainText('₹41,000'); // inrCompact(4100000)

    const bhagwati = rows.filter({ hasText: 'VND-2301' });
    await expect(bhagwati).toContainText('Bhagwati Logistics');
    await expect(bhagwati).toContainText('Hosur');
    await expect(bhagwati).toContainText('70%');
    await expect(bhagwati).toContainText('Cleared for loads');
  });

  test('search narrows to a matching vendor by name', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors');
    const main = page.locator('main');
    const search = main.getByPlaceholder('Transporter name or code');
    await search.fill('Bhagwati');
    await search.press('Enter');

    const rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Bhagwati Logistics');
  });

  test('search narrows to a matching vendor by code', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors');
    const main = page.locator('main');
    const search = main.getByPlaceholder('Transporter name or code');
    await search.fill('vnd-2287');
    await search.press('Enter');

    const rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Sai Kripa Carriers');
  });

  test('a search with no matches shows the empty state, not an empty table', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors');
    const main = page.locator('main');
    const search = main.getByPlaceholder('Transporter name or code');
    await search.fill('zzz-no-such-vendor');
    await search.press('Enter');

    await expect(main.getByText('No transporter matches this search.')).toBeVisible();
    await expect(main.locator('table.table')).toHaveCount(0);
  });

  test('status filter narrows to ACTIVE vendors', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors');
    const main = page.locator('main');
    await main.locator('select').selectOption('ACTIVE');

    const rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Bhagwati Logistics');
  });

  test('quick links to leads, market gap and issues are present', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors');
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: 'Leads' })).toHaveAttribute('href', '/vendors/leads');
    await expect(main.getByRole('link', { name: 'Where we are short of trucks' })).toHaveAttribute('href', '/vendors/market-gap');
    await expect(main.getByRole('link', { name: 'Problems' })).toHaveAttribute('href', '/vendors/issues');
  });
});

test.describe('Vendors — role gating on the list', () => {
  test('OPS holds vendor.edit and module EDIT, so it gets the create link and no view-only badge', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors');
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: 'Add a transporter' })).toBeVisible();
    // Operations owns vendor onboarding, so `vendors` is EDIT for OPS in
    // BR-29 — no view-only badge. The *clearance* decision is still
    // Compliance's: `vendor.verify`/`vendor.activate` are not in
    // SEED_GRANTS.OPS, which vendors/[id] covers separately.
    await expect(main.getByTestId('view-only')).toHaveCount(0);
  });

  test('COMPLIANCE (module EDIT, but lacks vendor.edit) does not see Onboard a vendor', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors');
    const main = page.locator('main');
    await expect(main.getByRole('link', { name: 'Add a transporter' })).toHaveCount(0);
    await expect(main.getByTestId('view-only')).toHaveCount(0);
  });
});

test.describe('Vendor onboarding wizard — /vendors/new', () => {
  test('COMPLIANCE cannot onboard — gets the blocked message, not the wizard', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors/new');
    await expect(
      page.getByText('Onboarding is a compliance and operations action. You are not able to create a vendor file.'),
    ).toBeVisible();
    await expect(page.getByText('1 · Company')).toHaveCount(0);
  });

  test('step 1 (Company) rejects an empty submit with field errors and does not advance', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');
    await main.getByRole('button', { name: 'Save and continue' }).click();

    await expect(field(main, 'Legal name').locator('.err')).toHaveText('Required');
    await expect(field(main, 'Base city').locator('.err')).toHaveText('Required');
    await expect(field(main, 'Phone').locator('.err')).toHaveText('Ten digits, Indian mobile');
    await expect(main.getByText('1 · Company')).toBeVisible();
  });

  test('step 1 advances to step 2 once required fields are valid; Back returns to step 1', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');

    await field(main, 'Legal name').locator('input').fill('Nexraah Test Transport');
    await field(main, 'Base city').locator('input').fill('Nashik');
    await field(main, 'Phone').locator('input').fill('9876543210');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(main.getByText('2 · Identity and legal file')).toBeVisible();

    await main.getByRole('button', { name: 'Back' }).click();
    await expect(main.getByText('1 · Company')).toBeVisible();
    await expect(field(main, 'Legal name').locator('input')).toHaveValue('Nexraah Test Transport');
  });

  test('step 3 (Fleet) rejects an empty submit and does not advance', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');

    await field(main, 'Legal name').locator('input').fill('Nexraah Test Transport');
    await field(main, 'Base city').locator('input').fill('Nashik');
    await field(main, 'Phone').locator('input').fill('9876543210');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(main.getByText('2 · Identity and legal file')).toBeVisible();

    // Step 2 (document capture) has no required-field gate — Continue always moves on.
    await main.getByRole('button', { name: 'Continue' }).click();
    await expect(main.getByText('3 · Fleet')).toBeVisible();

    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(field(main, 'Truck types').locator('.err')).toHaveText('Add at least one truck type');
    await expect(field(main, 'Operating states').locator('.err')).toHaveText('At least one state');
    await expect(field(main, 'Trucks').locator('.err')).toBeVisible();
    await expect(main.getByText('3 · Fleet')).toBeVisible();
  });

  test('step 4 (Payment) rejects an empty submit and does not advance', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');

    await field(main, 'Legal name').locator('input').fill('Nexraah Test Transport');
    await field(main, 'Base city').locator('input').fill('Nashik');
    await field(main, 'Phone').locator('input').fill('9876543210');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await main.getByRole('button', { name: 'Continue' }).click();

    await field(main, 'Trucks').locator('input').fill('5');
    await field(main, 'Truck types').getByRole('button', { name: 'Add' }).click();
    await field(main, 'Operating states').locator('select').selectOption('MH');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(main.getByText('4 · Payment')).toBeVisible();

    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(field(main, 'Account number').locator('.err')).toHaveText('Required');
    await expect(field(main, 'IFSC').locator('.err')).toHaveText('Required');
    await expect(field(main, 'Account holder').locator('.err')).toHaveText('Required');
    await expect(main.getByText('4 · Payment')).toBeVisible();
  });

  test('a malformed IFSC is rejected with a specific message', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');

    await field(main, 'Legal name').locator('input').fill('Nexraah Test Transport');
    await field(main, 'Base city').locator('input').fill('Nashik');
    await field(main, 'Phone').locator('input').fill('9876543210');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await main.getByRole('button', { name: 'Continue' }).click();
    await field(main, 'Trucks').locator('input').fill('5');
    await field(main, 'Truck types').getByRole('button', { name: 'Add' }).click();
    await field(main, 'Operating states').locator('select').selectOption('MH');
    await main.getByRole('button', { name: 'Save and continue' }).click();

    await field(main, 'Account number').locator('input').fill('123456789012');
    await field(main, 'IFSC').locator('input').fill('NOTANIFSC');
    await field(main, 'Account holder').locator('input').fill('Nexraah Test Transport');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(field(main, 'IFSC').locator('.err')).toHaveText('IFSC looks wrong');
    await expect(main.getByText('4 · Payment')).toBeVisible();
  });

  /**
   * `lib/ifsc.ts` — a real, live call to Razorpay's free public IFSC API
   * (https://ifsc.razorpay.com), not a mock. Genuinely hits the network;
   * skipped outside a real browser run isn't an option here since that's
   * the entire point, but it's advisory-only by design (`checkGstin`'s
   * sibling), so neither case below blocks or is required to proceed.
   */
  test('a shape-valid IFSC gets a live bank/branch confirmation, and an unknown one a soft not-found', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');

    await field(main, 'Legal name').locator('input').fill('Nexraah Test Transport');
    await field(main, 'Base city').locator('input').fill('Nashik');
    await field(main, 'Phone').locator('input').fill('9876543210');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await main.getByRole('button', { name: 'Continue' }).click();
    await field(main, 'Trucks').locator('input').fill('5');
    await field(main, 'Truck types').getByRole('button', { name: 'Add' }).click();
    await field(main, 'Operating states').locator('select').selectOption('MH');
    await main.getByRole('button', { name: 'Save and continue' }).click();

    // A real, verified-existing branch (HDFC, Park Street, Jaipur).
    await field(main, 'IFSC').locator('input').fill('HDFC0001234');
    await expect(field(main, 'IFSC')).toContainText('HDFC Bank', { timeout: 10_000 });
    await expect(field(main, 'IFSC')).toContainText('JAIPUR');

    // Shape-valid, but not a real branch code — advisory not-found, not an error.
    await field(main, 'IFSC').locator('input').fill('ZZZZ0999999');
    await expect(field(main, 'IFSC')).toContainText('No branch found', { timeout: 10_000 });
    await expect(field(main, 'IFSC')).toContainText('will not block saving');
    // The zod-level shape check still passes for this well-formed code, so
    // nothing here should read as a hard validation error.
    await expect(field(main, 'IFSC').locator('.err')).toHaveCount(0);
  });

  test('reaching Review and submitting an incomplete file is refused with the unmet checklist', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/new');
    const main = page.locator('main');

    await field(main, 'Legal name').locator('input').fill('Nexraah Test Transport');
    await field(main, 'Base city').locator('input').fill('Nashik');
    await field(main, 'Phone').locator('input').fill('9876543210');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await main.getByRole('button', { name: 'Continue' }).click();
    await field(main, 'Trucks').locator('input').fill('5');
    await field(main, 'Truck types').getByRole('button', { name: 'Add' }).click();
    await field(main, 'Operating states').locator('select').selectOption('MH');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await field(main, 'Account number').locator('input').fill('123456789012');
    await field(main, 'IFSC').locator('input').fill('HDFC0000123');
    await field(main, 'Account holder').locator('input').fill('Nexraah Test Transport');
    await main.getByRole('button', { name: 'Save and continue' }).click();
    await expect(main.getByText('5 · Review and submit')).toBeVisible();

    await main.getByRole('button', { name: 'Submit for verification' }).click();
    // BR-03: TDS declaration is mandatory for every party type, and this
    // draft never captured any document, so the server refuses (409 VENDOR_INCOMPLETE).
    await expect(main.getByText('This file cannot be submitted yet')).toBeVisible();
    await expect(main.getByText('TDS declaration not on file')).toBeVisible();
  });
});

test.describe('Vendor detail page', () => {
  test('renders the key facts of the vendor file', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors/v-2214');
    const main = page.locator('main');

    await expect(main.getByRole('heading', { name: 'Rathod Roadlines' })).toBeVisible();
    await expect(main.getByText('VND-2214 · Nashik · proprietorship')).toBeVisible();

    const vendorPanel = panel(main, 'Vendor');
    await expect(vendorPanel).toContainText('VND-2214');
    await expect(vendorPanel).toContainText('27AAKCR2148L1ZP'); // GSTIN
    await expect(vendorPanel).toContainText('AAKCR2148L'); // PAN
    await expect(vendorPanel).toContainText('14 trucks');
    await expect(vendorPanel).toContainText('MH, GJ, MP, WB');
    await expect(vendorPanel).toContainText('••4471 · HDFC0000188');

    // Not yet active — the two unverified/missing documents are named.
    await expect(main.getByText('Vendor not yet active')).toBeVisible();
    await expect(main.getByText('UDYAM pending')).toBeVisible();
    await expect(main.getByText('TRANSPORTER AGREEMENT not on file')).toBeVisible();

    const businessPanel = panel(main, 'Trips and business');
    await expect(businessPanel).toContainText('41'); // trips
    await expect(businessPanel).toContainText('₹18.9 L'); // revenue, inrCompact(189400000)
    await expect(businessPanel).toContainText('₹2.4 L'); // margin, inrCompact(24100000)
    await expect(businessPanel).toContainText('12.7%'); // margin %

    const moneyPanel = panel(main, 'Money with us');
    await expect(moneyPanel).toContainText('₹23,360'); // advance outstanding
    await expect(moneyPanel).toContainText('₹35,040'); // balance pending
  });

  test('COMPLIANCE sees Clear and activate, disabled while unmet items remain', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors/v-2214');
    const main = page.locator('main');
    const activateBtn = main.getByRole('button', { name: 'Clear and activate' });
    await expect(activateBtn).toBeVisible();
    await expect(activateBtn).toBeDisabled();
  });

  test('OPS (no vendor.activate) never sees Clear and activate', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/v-2214');
    const main = page.locator('main');
    await expect(main.getByRole('button', { name: 'Clear and activate' })).toHaveCount(0);
    await expect(main.getByText('Compliance clears vendors.')).toBeVisible();
  });

  test('an ACTIVE vendor shows the active banner instead of the blocked panel', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors/v-2301');
    const main = page.locator('main');
    await expect(main.getByText('Vendor active')).toBeVisible();
    await expect(main.getByText('Cleared by Meera Iyer · may be awarded indents on any branch')).toBeVisible();
    await expect(main.getByText('Vendor not yet active')).toHaveCount(0);
  });
});

test.describe('Vendor leads — /vendors/leads', () => {
  test('renders the seeded pipeline', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/leads');
    const main = page.locator('main');
    const rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(4);

    await expect(rows.filter({ hasText: 'LD-0084' })).toContainText('Deshpande Carriers');
    await expect(rows.filter({ hasText: 'LD-0085' })).toContainText('Yash Transport');
    await expect(rows.filter({ hasText: 'LD-0086' })).toContainText('Sri Lakshmi Roadways');
    await expect(rows.filter({ hasText: 'LD-0087' })).toContainText('Kutch Freight Lines');
    await expect(rows.filter({ hasText: 'LD-0087' })).toContainText('—'); // empty notes render as a dash
  });

  test('OPS (vendor.edit) sees Start onboarding only on the QUALIFIED lead', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/leads');
    const main = page.locator('main');
    const links = main.getByRole('link', { name: 'Start onboarding' });
    await expect(links).toHaveCount(1);
    await expect(main.locator('table.table tbody tr').filter({ hasText: 'LD-0084' })).toContainText(
      'Start onboarding',
    );
  });

  test('COMPLIANCE (no vendor.edit) sees read-only stage tags, not a dropdown', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors/leads');
    const main = page.locator('main');
    await expect(main.locator('select')).toHaveCount(0);
    await expect(main.getByText('QUALIFIED', { exact: true })).toBeVisible();
    await expect(main.getByText('DOCUMENTS REQUESTED', { exact: true })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Start onboarding' })).toHaveCount(0);
  });
});

test.describe('Vendor market gap — /vendors/market-gap', () => {
  test('renders seeded rows with the computed gap and progress', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/market-gap');
    const main = page.locator('main');
    const rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(4);

    const nsk = rows.filter({ hasText: 'Nashik → Kolkata' });
    await expect(nsk).toContainText('Nashik');
    await expect(nsk).toContainText('32 ft SXL');
    await expect(nsk).toContainText('5'); // gap = target 8 - onPanel 3
    await expect(nsk).toContainText('13%'); // round(converted 1 / target 8 * 100)

    const gdm = rows.filter({ hasText: 'Mundra → Jaipur' });
    await expect(gdm).toContainText('Gandhidham');
    await expect(gdm).toContainText('1'); // gap = target 5 - onPanel 4
    await expect(gdm).toContainText('60%'); // round(3/5*100)
  });

  test('OPS (vendor.edit) sees editable target inputs seeded with the current target', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/market-gap');
    const main = page.locator('main');
    const inputs = main.locator('table.table tbody input[type="number"]');
    await expect(inputs).toHaveCount(4);
    await expect(inputs.first()).toHaveValue('8'); // mg-1 target
  });

  test('COMPLIANCE (no vendor.edit) sees plain target numbers, no inputs', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors/market-gap');
    const main = page.locator('main');
    await expect(main.locator('table.table tbody input')).toHaveCount(0);
    await expect(main.locator('table.table tbody tr').first()).toContainText('8'); // still shows the target
  });
});

test.describe('Vendor issues — /vendors/issues', () => {
  test('renders seeded issues with formatted categories and severities', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/issues');
    const main = page.locator('main');
    const rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(3);

    const is41 = rows.filter({ hasText: 'IS-0041' });
    await expect(is41).toContainText('Rathod Roadlines');
    await expect(is41).toContainText('pod delay');
    await expect(is41).toContainText('HIGH');
    await expect(is41).toContainText('TRP-120881');

    const is43 = rows.filter({ hasText: 'IS-0043' });
    await expect(is43).toContainText('Rathod Roadlines');
    await expect(is43).toContainText('driver conduct');
    await expect(is43).toContainText('—'); // no related trip
  });

  test('OPS (vendor.edit) sees an editable status dropdown per row', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/vendors/issues');
    const main = page.locator('main');
    await expect(main.locator('table.table tbody select')).toHaveCount(3);
  });

  test('COMPLIANCE (no vendor.edit) sees read-only status tags', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/vendors/issues');
    const main = page.locator('main');
    const tbody = main.locator('table.table tbody');
    await expect(tbody.locator('select')).toHaveCount(0);
    // Scoped to the table body — the page header's status *filter* also has
    // an "OPEN" <option>, which would otherwise collide with the Tag text.
    await expect(tbody.getByText('OPEN', { exact: true })).toBeVisible();
    await expect(tbody.getByText('RESOLVED', { exact: true })).toBeVisible();
  });

  test('status filter narrows to the matching issues only', async ({ page }) => {
    await setRole(page, 'COMPLIANCE'); // read-only role keeps exactly one <select> on the page (the filter)
    await page.goto('/vendors/issues');
    const main = page.locator('main');
    const filterSelect = main.locator('select');
    await expect(filterSelect).toHaveCount(1);

    await filterSelect.selectOption('OPEN');
    let rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('IS-0041');

    await filterSelect.selectOption('RESOLVED');
    rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('IS-0043');

    await filterSelect.selectOption('');
    rows = main.locator('table.table tbody tr');
    await expect(rows).toHaveCount(3);
  });
});
