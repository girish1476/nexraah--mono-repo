import { test, expect, Page, Locator } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Client master — `/clients`, `/clients/new`, `/clients/[id]` (lib/permissions.ts
 * `clients` module: FINANCE=EDIT, OPS/COMPLIANCE/BRANCH_MGR/LEADERSHIP=VIEW,
 * ADMIN=NONE, gated by `useLevel('clients')` rather than a named permission).
 *
 * Fixture facts pinned against `src/mocks/db.ts`:
 *  - CLT-0092 Berger Paints · Kolkata · CONTRACT · 45 credit days ·
 *    outstanding ₹8.4 L · rate card lanes Kolkata → Nashik and
 *    Kolkata → Guwahati (both from RFQ lane provenance).
 *  - CLT-0088 Sanghvi Metals · Vijayawada · SPOT (no rate card lanes; the
 *    page shows the per-indent-approval note instead of a table).
 *  - CLT-0090 Apex Ceramics · Gandhidham · CONTRACT.
 *
 * `/clients` has no search box in the current implementation (list + filters
 * live on the invoices/trips/vendors screens, not here) — coverage below is
 * list rendering, not search, matching what `src/app/clients/page.tsx`
 * actually renders.
 *
 * The "create a client" happy path is a one-way mutation against the shared
 * mock db (no reset endpoint): it appends a row and advances the CLIENT
 * number series. Assertions elsewhere never depend on an exact client count,
 * so reruns stay safe.
 */

const field = (page: Page, label: string): Locator =>
  page.locator('div.field').filter({ has: page.getByText(label, { exact: true }) });

const fieldControl = (page: Page, label: string): Locator =>
  field(page, label).locator('input, select, textarea').first();

test.describe('clients list', () => {
  test('FINANCE sees all seeded clients and can reach the create form', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients');

    await expect(page.getByRole('link', { name: 'New client' })).toBeVisible();

    const rows = page.locator('table.table tbody tr');
    const berger = rows.filter({ hasText: 'CLT-0092' });
    await expect(berger).toContainText('Berger Paints');
    await expect(berger).toContainText('Kolkata');
    await expect(berger).toContainText('CONTRACT');
    await expect(berger).toContainText('45 days');

    await expect(rows.filter({ hasText: 'CLT-0088' })).toContainText('Sanghvi Metals');
    await expect(rows.filter({ hasText: 'CLT-0090' })).toContainText('Apex Ceramics');
  });

  test('OPS (VIEW) sees the list with no New client link', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/clients');

    await expect(page.locator('table.table tbody tr').filter({ hasText: 'CLT-0092' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New client' })).toHaveCount(0);
  });
});

test.describe('client detail', () => {
  test('a contract client shows its facts and its read-only rate card', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/c-0092');

    await expect(page.getByRole('heading', { name: 'Berger Paints' })).toBeVisible();
    await expect(page.getByText('CLT-0092 · Kolkata · contract')).toBeVisible();

    await expect(page.getByText('19AAACB2545C1Z9')).toBeVisible(); // GSTIN
    await expect(page.getByText('A. Bose')).toBeVisible(); // Contact
    await expect(page.getByText('₹8.4 L')).toBeVisible(); // outstanding, compact

    await expect(page.getByText('Read-only · from RFQ award')).toBeVisible();
    const laneRows = page.locator('table.table tbody tr');
    await expect(laneRows.filter({ hasText: 'Kolkata → Nashik' })).toBeVisible();
    await expect(laneRows.filter({ hasText: 'Kolkata → Guwahati' })).toBeVisible();
  });

  test('a spot client has no rate card table, only the per-indent note', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/c-0088');

    await expect(page.getByRole('heading', { name: 'Sanghvi Metals' })).toBeVisible();
    await expect(page.getByText('CLT-0088 · Vijayawada · spot')).toBeVisible();
    await expect(
      page.getByText('Rates are set per indent with the client’s written approval.'),
    ).toBeVisible();
    await expect(page.locator('table.table')).toHaveCount(0);
  });
});

test.describe('new client form', () => {
  test('OPS (VIEW) is blocked from the create form', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/clients/new');

    await expect(page.getByText('Creating a client is a finance action.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create client' })).toHaveCount(0);
  });

  test('FINANCE submitting an empty form surfaces every required-field error', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');

    await page.getByRole('button', { name: 'Create client' }).click();

    // name, billing city, contact (min-length "Required") + phone + email +
    // agreementNo (CONTRACT is the default engagement, via the zod .refine).
    await expect(page.locator('span.err')).toHaveCount(6);
    await expect(page.locator('span.err', { hasText: 'Required' })).toHaveCount(3);
    await expect(page.getByText('Ten digits')).toBeVisible();
    await expect(page.getByText('Not an email')).toBeVisible();
    await expect(page.getByText('A contract client needs an agreement number')).toBeVisible();

    // creditDays (45) and serviceLevel ("Next day placement") already carry
    // valid defaults, so neither should be in the error set.
    await expect(field(page, 'Credit days').locator('span.err')).toHaveCount(0);
  });

  test('billing city is capitalized on blur', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');

    const city = fieldControl(page, 'Billing city');
    await city.fill('nashik');
    await city.blur();
    await expect(city).toHaveValue('Nashik');
  });

  test('a fully valid submission creates the client and lands on its file', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');

    await fieldControl(page, 'Name').fill('Test Freight Co');
    await fieldControl(page, 'Billing city').fill('Nashik');
    await fieldControl(page, 'Contact').fill('Test Contact');
    await fieldControl(page, 'Phone').fill('9876543210');
    await fieldControl(page, 'Email').fill('test.freight@example.com');
    // Engagement stays CONTRACT (the default) — agreement number is required.
    await fieldControl(page, 'Agreement number').fill('TFC/RC/2026');

    await page.getByRole('button', { name: 'Create client' }).click();

    await expect(page.getByText(/^CLT-\d+ created$/)).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/c-/);
    await expect(page.getByRole('heading', { name: 'Test Freight Co' })).toBeVisible();
    await expect(page.getByText('Nashik · contract', { exact: false })).toBeVisible();
  });
});
