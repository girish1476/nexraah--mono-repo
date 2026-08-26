import { test, expect, Page, Locator } from '@playwright/test';
import { setRole, statValue } from './helpers';

/**
 * Billing surfaces — `/invoices`, `/invoices/new`, `/invoices/[id]`,
 * `/receivables`, `/pnl` (lib/permissions.ts `invoices` · `receivables` ·
 * `pnl` modules). FINANCE is EDIT on all three; OPS and LEADERSHIP
 * are VIEW on invoices/receivables (LEADERSHIP is EDIT on pnl).
 *
 * Fixture facts pinned against `src/mocks/db.ts`:
 *  - inv-411 / NEX-INV-000411 · Berger Paints · PART_PAID · total ₹22,400 ·
 *    received ₹10,000 (receipt RCT-0330) · balance ₹12,400 · due in future
 *    (CURRENT ageing bucket).
 *  - inv-410 / NEX-INV-000410 · Apex Ceramics · ISSUED · total ₹36,550 ·
 *    received ₹0 · balance ₹36,550 · due 4 days ago (0–30 days bucket).
 *  - Delivered, unbilled trips: TRP-120881 and TRP-120874 (both Berger
 *    Paints), TRP-120855 (Apex Ceramics). Sanghvi Metals (SPOT) has none.
 *  - `/pnl` returns 5 branch rows — no fixture user carries a branch, so
 *    nothing is scoped. Exceptions (delivered, zero charge lines): TRP-120874 and
 *    TRP-120869.
 *
 * A few tests mutate the shared mock db (there is no reset endpoint — see
 * `src/mocks/db.ts`): the "save draft" test appends a DRAFT invoice, which
 * never satisfies an ISSUED/PART_PAID/PAID/CANCELLED filter, so it cannot
 * disturb the count-based assertions above across reruns.
 */

const field = (page: Page, label: string): Locator =>
  page.locator('div.field').filter({ has: page.getByText(label, { exact: true }) });

const fieldControl = (page: Page, label: string): Locator =>
  field(page, label).locator('input, select, textarea').first();

test.describe('invoices list', () => {
  test('FINANCE sees both seeded invoices and the header stats add up', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices');

    await expect(page.getByRole('link', { name: 'New invoice' })).toBeVisible();

    const rows = page.locator('table.table tbody tr');
    await expect(rows.filter({ hasText: 'NEX-INV-000411' })).toBeVisible();
    await expect(rows.filter({ hasText: 'NEX-INV-000410' })).toBeVisible();

    const stat = (label: string) =>
      page.locator('.stat-strip > div').filter({ has: page.getByText(label, { exact: true }) });
    // open = ISSUED + PART_PAID = both seeded invoices, regardless of any
    // DRAFT rows other test runs may have appended.
    await expect(statValue(page, 'bills-open')).toHaveText('2');
    await expect(statValue(page, 'bills-open-value')).toHaveText('₹48,950');
    await expect(statValue(page, 'bills-collected')).toHaveText('0');
    await expect(statValue(page, 'bills-cancelled')).toHaveText('0');
  });

  test('status filter isolates a single invoice', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices');

    await fieldControl(page, 'Status').selectOption('PART_PAID');
    const rows = page.locator('table.table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('NEX-INV-000411');

    await fieldControl(page, 'Status').selectOption('ISSUED');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('NEX-INV-000410');
  });

  test('search filters by client name, case-insensitively', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices');

    const search = fieldControl(page, 'Search');
    await search.fill('apex');
    await search.press('Enter');

    const rows = page.locator('table.table tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('NEX-INV-000410');
  });

  test('Operations (VIEW) sees the ledger read-only, with no New invoice link', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/invoices');

    await expect(page.getByTestId('view-only')).toBeVisible();
    await expect(page.getByRole('link', { name: 'New invoice' })).toHaveCount(0);
    await expect(page.locator('table.table tbody tr').first()).toBeVisible();
  });
});

test.describe('new invoice form', () => {
  test('Save draft and Generate invoice stay disabled until client and trips are chosen', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices/new');

    const saveDraft = page.getByRole('button', { name: 'Save draft' });
    const generate = page.getByRole('button', { name: 'Generate invoice' });
    await expect(saveDraft).toBeDisabled();
    await expect(generate).toBeDisabled();

    await fieldControl(page, 'Client').selectOption({ label: 'Berger Paints' });
    await expect(saveDraft).toBeEnabled();
    await expect(generate).toBeDisabled(); // still no trip selected

    const rows = page.locator('table.table tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'TRP-120881' })).toBeVisible();
    await expect(rows.filter({ hasText: 'TRP-120874' })).toBeVisible();

    const totalPanel = page
      .locator('div.surface')
      .filter({ has: page.getByRole('heading', { name: 'Total', exact: true }) });
    await expect(totalPanel.locator('span.mono').last()).toHaveText('₹0');

    await rows.filter({ hasText: 'TRP-120881' }).locator('input[type="checkbox"]').check();
    await expect(generate).toBeEnabled();
    await expect(totalPanel.locator('span.mono').last()).toHaveText('₹64,200');
  });

  test('a client with no delivered trips shows the empty state', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices/new');

    await fieldControl(page, 'Client').selectOption({ label: 'Sanghvi Metals' });
    await expect(
      page.getByText('No delivered unbilled consignments for this client.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Generate invoice' })).toBeDisabled();
  });

  test('Operations without invoice.create is blocked from the form', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/invoices/new');

    await expect(page.getByText('Invoicing is a finance action.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  });

  test('FINANCE can save a draft and land on its detail page', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices/new');

    await fieldControl(page, 'Client').selectOption({ label: 'Berger Paints' });
    const rows = page.locator('table.table tbody tr');
    await rows.filter({ hasText: 'TRP-120881' }).locator('input[type="checkbox"]').check();
    await rows.filter({ hasText: 'TRP-120874' }).locator('input[type="checkbox"]').check();

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expect(page).toHaveURL(/\/invoices\/inv-/);

    await expect(page.getByRole('heading', { name: 'Draft invoice' })).toBeVisible();
    // Not yet issued: Generate is offered, Cancel and the PDF are not.
    await expect(page.getByRole('button', { name: 'Generate invoice' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download PDF' })).toHaveCount(0);
    const consignmentRows = page.locator('table.table tbody tr');
    await expect(consignmentRows.filter({ hasText: 'TRP-120881' })).toBeVisible();
    await expect(consignmentRows.filter({ hasText: 'TRP-120874' })).toBeVisible();
  });
});

test.describe('invoice detail', () => {
  test('FINANCE sees the full seeded invoice, and the cancel dialog validates before closing', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/invoices/inv-411');

    await expect(page.getByRole('heading', { name: 'NEX-INV-000411' })).toBeVisible();
    await expect(page.getByText('Berger Paints', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('GST payable by recipient under reverse charge').first()).toBeVisible();

    const receiptRows = page.locator('table.table tbody tr');
    await expect(receiptRows.filter({ hasText: 'RCT-0330' })).toContainText('₹10,000');
    await expect(receiptRows.filter({ hasText: 'TRP-120874' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();
    const dialog = page
      .locator('div.surface')
      .filter({ has: page.getByRole('heading', { name: 'Cancel this invoice' }) });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Cancel invoice' });
    await expect(confirm).toBeDisabled();
    await dialog.locator('textarea').fill('e2e check only — not a real cancellation');
    await expect(confirm).toBeEnabled();

    // Close without confirming — inv-411 must stay PART_PAID for every other
    // test (and every rerun) in this file.
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('PART PAID')).toBeVisible();
  });

  test('Operations (VIEW) can read an issued invoice but gets no mutating controls', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/invoices/inv-410');

    await expect(page.getByRole('heading', { name: 'NEX-INV-000410' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download PDF' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Generate invoice' })).toHaveCount(0);
  });
});

test.describe('receivables', () => {
  test('FINANCE sees the ageing buckets and both open invoices', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/receivables');

    const stat = (label: string) =>
      page.locator('.stat-strip > div').filter({ has: page.getByText(label, { exact: true }) });
    await expect(stat('Not yet due').locator('.stat-value')).toHaveText('₹12,400');
    await expect(stat('0–30 days').locator('.stat-value')).toHaveText('₹36,550');

    // The outstanding-invoices table is the first table on the page; "Recent
    // receipts" is a second, separate table further down.
    const rows = page.locator('table.table').nth(0).locator('tbody tr');
    await expect(rows.filter({ hasText: 'NEX-INV-000411' })).toContainText('Not yet due');
    await expect(rows.filter({ hasText: 'NEX-INV-000410' })).toContainText('0–30 days');

    // Recent receipts sub-table.
    await expect(page.locator('table.table').nth(1)).toContainText('RCT-0330');
  });

  test('recording a receipt validates a reference before it can be confirmed', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/receivables');

    await page
      .locator('table.table tbody tr')
      .filter({ hasText: 'NEX-INV-000411' })
      .getByRole('button', { name: 'Record receipt' })
      .click();

    const dialog = page
      .locator('div.surface')
      .filter({ has: page.getByRole('heading', { name: 'Record a receipt' }) });
    await expect(dialog).toBeVisible();
    // Balance fact (FactList renders it as a `span.mono`, distinct from the
    // `span.muted` hint under the Amount field that also mentions ₹12,400).
    await expect(dialog.locator('span.mono', { hasText: '₹12,400' })).toBeVisible();
    const confirm = dialog.getByRole('button', { name: 'Record receipt' });
    await expect(confirm).toBeDisabled(); // reference is empty

    await fieldControl(page, 'UTR or cheque number').fill('TESTUTR001');
    await expect(confirm).toBeEnabled();

    // Close without submitting — keep inv-411's balance intact for reruns.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('Operations (VIEW) sees the ledger without a Record receipt control', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/receivables');

    await expect(page.locator('table.table tbody tr').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record receipt' })).toHaveCount(0);
  });
});

test.describe('P&L', () => {
  test('FINANCE sees every branch and the zero-charge exceptions', async ({ page }, testInfo) => {
    await setRole(page, 'FINANCE');
    await page.goto('/pnl');

    // "All branches" also appears in the sidebar's branch-scope indicator —
    // scope to the page body to avoid that match.
    await expect(page.locator('main').getByText('All branches', { exact: true })).toBeVisible();
    // The branch rows are the first table; a second table (exceptions)
    // renders further down the page, so scope to avoid double-counting.
    const rows = page.locator('table.table').nth(0).locator('tbody tr');
    await expect(rows).toHaveCount(5);
    for (const branch of ['Nashik', 'Pune', 'Vijayawada', 'Gandhidham', 'Hosur']) {
      await expect(rows.filter({ hasText: branch })).toBeVisible();
    }
    // Below the 767px breakpoint DataTable hides <thead> entirely and
    // collapses to cards (NFR-06) — the column label isn't rendered at all.
    if (testInfo.project.name !== 'mobile') {
      await expect(page.locator('th', { hasText: 'Branch / period' })).toBeVisible();
    }

    await expect(page.getByText('2 trip(s) overstate margin')).toBeVisible();
    const exceptionRows = page.locator('table.table').nth(1).locator('tbody tr');
    await expect(exceptionRows.filter({ hasText: 'TRP-120874' })).toBeVisible();
    await expect(exceptionRows.filter({ hasText: 'TRP-120869' })).toBeVisible();
  });

  test('switching granularity relabels the period column', async ({ page }, testInfo) => {
    // The column header this test asserts on is hidden below the 767px
    // breakpoint (DataTable's mobile card-collapse, NFR-06) — this test is
    // inherently about desktop table-header behavior.
    test.skip(testInfo.project.name === 'mobile', 'column headers are hidden on the mobile card layout');

    await setRole(page, 'FINANCE');
    await page.goto('/pnl');

    await expect(page.locator('th', { hasText: 'Branch / period' })).toBeVisible();
    await fieldControl(page, 'Granularity').selectOption('DAILY');
    await expect(page.locator('th', { hasText: /^Period$/ })).toBeVisible();
  });

  // Operations inherited `pnl.view_own` and VIEW on the module. It carries no
  // branch, so "own" resolves to everything — the read-only badge, not the
  // row count, is what this pins.
  test('Operations (VIEW) reads the P&L without mutating controls', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/pnl');

    await expect(page.getByTestId('view-only')).toBeVisible();
    await expect(page.getByText('All branches', { exact: true })).toBeVisible();
    await expect(page.locator('table.table tbody tr')).toHaveCount(5);

    await expect(page.getByText(/overstate margin/)).toHaveCount(0);
  });
});
