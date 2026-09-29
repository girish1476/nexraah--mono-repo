import { test, expect, Page, Locator } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Client master — `/clients`, `/clients/new`, `/clients/[id]` (lib/permissions.ts
 * `clients` module: FINANCE/COMPLIANCE=EDIT, OPS/LEADERSHIP=VIEW,
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

/**
 * Fields are located by the `name` react-hook-form registers on the control,
 * not by the words above it.
 *
 * These used to filter `div.field` by exact label text, which meant the form
 * could not be relabelled without the spec going red — and this console's
 * copy is deliberately rewritten whenever a clearer phrase turns up.
 * "Name" became "Company name" and "Contact" became "Contact person" in a
 * clarity pass, and both of these broke on wording alone while the form
 * itself worked perfectly. `name` is the schema's own handle: it only
 * changes when the *field* changes, which is exactly when a spec should have
 * to be reread. Same trade `rbac-nav.spec.ts` makes with href over label.
 */
const control = (page: Page, name: string): Locator => page.locator(`[name="${name}"]`);

/** The whole field block — label, control, hint and error — around one control. */
const field = (page: Page, name: string): Locator =>
  page.locator('div.field').filter({ has: page.locator(`[name="${name}"]`) });

test.describe('clients list', () => {
  test('FINANCE sees all seeded clients and can reach the create form', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients');

    await expect(page.getByRole('link', { name: 'New client' })).toBeVisible();

    const rows = page.locator('table.table tbody tr');
    const berger = rows.filter({ hasText: 'CLT-0092' });
    await expect(berger).toContainText('Berger Paints');
    await expect(berger).toContainText('Kolkata');
    // The engagement is rendered as a word, not the stored code — the console
    // never shows a spec code to a person. `CONTRACT` lives in the fixture and
    // the API contract; "Contract" is what the row says.
    await expect(berger).toContainText('Contract');
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
    await expect(page.getByText('CLT-0092 · billed at Kolkata · contract client')).toBeVisible();

    await expect(page.getByText('19AAACB2545C1Z9')).toBeVisible(); // GSTIN
    await expect(page.getByText('A. Bose')).toBeVisible(); // Contact
    await expect(page.getByText('₹8.4 L')).toBeVisible(); // outstanding, compact

    // The provenance moved from the panel's own line into the Read-only tag's
    // `reason` tooltip. What matters is that the sheet is marked unkeyable.
    await expect(page.getByText('Read-only', { exact: true })).toBeVisible();
    const laneRows = page.locator('table.table tbody tr');
    await expect(laneRows.filter({ hasText: 'Kolkata → Nashik' })).toBeVisible();
    await expect(laneRows.filter({ hasText: 'Kolkata → Guwahati' })).toBeVisible();
  });

  test('a spot client has no rate card table, only the per-indent note', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/c-0088');

    await expect(page.getByRole('heading', { name: 'Sanghvi Metals' })).toBeVisible();
    await expect(page.getByText('CLT-0088 · billed at Vijayawada · spot client')).toBeVisible();
    // Asserted on the empty-state title rather than its hint: the hint is a
    // two-sentence explanation that gets reworded, and it carries a typographic
    // apostrophe that is easy to break a spec on for no reason.
    await expect(page.getByText('No rate card — this client is priced per load')).toBeVisible();
    await expect(page.locator('table.table')).toHaveCount(0);
  });
});

test.describe('new client form', () => {
  test('OPS (VIEW) is blocked from the create form', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/clients/new');

    // Not the `ModuleLock` panel: OPS holds VIEW on clients, not NONE, so the
    // module is theirs to read and only the *create* action is withheld. The
    // page says so and points at the list, rather than locking the screen.
    await expect(page.getByText('Only Finance can add a client')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create client' })).toHaveCount(0);
  });

  test('FINANCE submitting an empty form surfaces every required-field error', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');

    await page.getByRole('button', { name: 'Create client' }).click();

    // name, billing city and contact (min-length) + phone + email +
    // agreementNo (CONTRACT is the default engagement, via the zod .refine).
    await expect(page.locator('span.err')).toHaveCount(6);

    // Which fields complain, rather than what each one says. The messages were
    // rewritten from terse validator-speak into instructions ("Ten digits" is
    // now "Enter a 10-digit Indian mobile number"), and pinning those words
    // here would mean the next clarity pass reds a test about *validation*.
    for (const name of ['name', 'billingCity', 'contact', 'phone', 'email', 'agreementNo']) {
      await expect(field(page, name).locator('span.err')).toHaveCount(1);
    }

    // creditDays (45) and serviceLevel ("Next day placement") already carry
    // valid defaults, so neither should be in the error set.
    await expect(field(page, 'creditDays').locator('span.err')).toHaveCount(0);
    await expect(field(page, 'serviceLevel').locator('span.err')).toHaveCount(0);
  });

  test('billing city is capitalized on blur', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');

    const city = control(page, 'billingCity');
    await city.fill('nashik');
    await city.blur();
    await expect(city).toHaveValue('Nashik');
  });

  test('a fully valid submission creates the client and lands on its file', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/new');

    await control(page, 'name').fill('Test Freight Co');
    await control(page, 'billingCity').fill('Nashik');
    await control(page, 'contact').fill('Test Contact');
    await control(page, 'phone').fill('9876543210');
    await control(page, 'email').fill('test.freight@example.com');
    // Engagement stays CONTRACT (the default) — agreement number is required.
    await control(page, 'agreementNo').fill('TFC/RC/2026');

    await page.getByRole('button', { name: 'Create client' }).click();

    // The toast now names the client it created, not just its code.
    await expect(page.getByText(/^CLT-\d+ · Test Freight Co added$/)).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/c-/);
    await expect(page.getByRole('heading', { name: 'Test Freight Co' })).toBeVisible();
    await expect(page.getByText('Nashik · contract', { exact: false })).toBeVisible();
  });
});
