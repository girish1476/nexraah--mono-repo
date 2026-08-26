import { test, expect, Page } from '@playwright/test';
import { setRole, statValue } from './helpers';

/**
 * `/home` — the reporting dashboard (part 10 §2). `GET /reports/home` in
 * `src/mocks/index.ts` returns static branch/client rows regardless of the
 * `month` query param, so the numbers below are stable across any month —
 * derived once from the fixture, not guessed:
 *
 *   branches: Nashik 412 trips / ₹18.64Cr rev / ₹15.98Cr cost
 *             Pune 388 / ₹17.21Cr / ₹14.83Cr
 *             Vijayawada 301 / ₹13.94Cr / ₹12.26Cr
 *             Gandhidham 266 / ₹15.38Cr / ₹13.71Cr
 *             Hosur 194 / ₹9.87Cr / ₹8.72Cr
 *   → month.trips = 1561, revenue = ₹75.04Cr (÷100 → "₹7.50 Cr" via
 *     inrCompact, which divides paise by 1e2 then by 1e7 for Cr), cost =
 *     "₹6.55 Cr", margin = "₹95.4 L", margin% = 12.7.
 *
 * No fixture user carries a branch any more, so every role sees every branch.
 * Branch scoping is now a property of the person (`users.branch_id`), not of
 * a role — see the note in `scopeBranch` (src/mocks/index.ts).
 */

/**
 * Opens "Show the full monthly detail".
 *
 * The snapshot leads with four figures and folds everything else — the month,
 * the branches, the delivery paperwork, the money and the top clients — into
 * one disclosure, so leadership gets an answer before a wall of numbers. A
 * closed `<details>` is outside the accessibility tree, which means
 * `getByRole` cannot see the panels inside it at all; the detail has to be
 * opened first, exactly as a reader would.
 */
async function showFullDetail(page: Page) {
  // No `if (count)` guard here. The page renders a loading skeleton first, so
  // a count taken the instant after `goto` is legitimately 0 and the guard
  // turned this into a silent no-op — the caller then failed much later,
  // looking like a missing panel rather than a fold nobody opened. Clicking
  // directly lets Playwright auto-wait for the summary to exist.
  await page.getByText('Show the full monthly detail').first().click();
}



test.describe('home — leadership dashboard (LEADERSHIP, unscoped)', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'Business snapshot', exact: true })).toBeVisible();
    await showFullDetail(page);
  });

  test('the month strip shows the aggregated seeded figures', async ({ page }) => {
    await expect(statValue(page, 'month-loads')).toHaveText('1561');
    await expect(statValue(page, 'month-billed')).toHaveText('₹7.50 Cr');
    await expect(statValue(page, 'month-paid')).toHaveText('₹6.55 Cr');
    await expect(statValue(page, 'month-kept')).toHaveText('₹95.4 L');
    await expect(statValue(page, 'month-kept-pct')).toHaveText('12.7%');
    await expect(statValue(page, 'month-transporters')).toHaveText('38');
  });

  test('the on-time / placement stat strip shows the seeded figures', async ({ page }) => {
    await expect(statValue(page, 'month-on-time')).toHaveText('91.4%');
    await expect(statValue(page, 'month-placed-by-pickup')).toHaveText('1489');
    await expect(statValue(page, 'month-failures')).toHaveText('72');
    await expect(statValue(page, 'month-trucks')).toHaveText('412');
  });

  test('branches table lists all five branches with the right columns', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'How each branch did' }) });
    const headers = panel.locator('thead th');
    await expect(headers).toHaveText([
      'Branch',
      'Loads moved',
      'Billed to clients',
      'Paid to transporters',
      'What we kept',
      'Kept per ₹100',
      'Share of the month',
    ]);

    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(5);
    await expect(panel.getByText('Nashik', { exact: true })).toBeVisible();
    await expect(panel.getByText('Pune', { exact: true })).toBeVisible();
    await expect(panel.getByText('Vijayawada', { exact: true })).toBeVisible();
    await expect(panel.getByText('Gandhidham', { exact: true })).toBeVisible();
    await expect(panel.getByText('Hosur', { exact: true })).toBeVisible();
  });

  test('POD-collection stat strip shows the seeded figures', async ({ page }) => {
    await expect(statValue(page, 'pod-delivered')).toHaveText('1488');
    await expect(statValue(page, 'pod-collected')).toHaveText('1351');
    // Pending is computed from the (unscoped) trip fixture: 3 of the 4
    // seeded trips are delivered but not APPROVED/WAIVED.
    await expect(statValue(page, 'pod-pending')).toHaveText('3');
    await expect(statValue(page, 'pod-within-tat')).toHaveText('1288');
    await expect(statValue(page, 'pod-breached')).toHaveText('63');
    await expect(statValue(page, 'pod-collection-pct')).toHaveText('90.8%');
    await expect(statValue(page, 'pod-penalty')).toHaveText('₹6,300');
  });

  test('money in and money out strip shows the seeded figures', async ({ page }) => {
    await expect(statValue(page, 'standing-advances')).toHaveText('₹1.8 L');
    await expect(statValue(page, 'standing-final-owed')).toHaveText('₹3.2 L');
    await expect(statValue(page, 'standing-receivables')).toHaveText('₹14.5 L');
    await expect(statValue(page, 'standing-not-billed')).toHaveText('41');
  });

  test('top clients panel lists the three seeded clients by revenue', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Our biggest clients this month' }) });
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(panel.getByText('Berger Paints')).toBeVisible();
    await expect(panel.getByText('Apex Ceramics')).toBeVisible();
    await expect(panel.getByText('Sanghvi Metals')).toBeVisible();
  });

  test('changing the month picker re-fetches and re-renders without error', async ({ page }) => {
    const picker = page.locator('input[type="month"]');
    const initial = await picker.inputValue();
    const target = initial.startsWith('2025') ? '2025-01' : '2025-06';

    await picker.fill(target);
    await picker.blur();

    await expect(picker).toHaveValue(target);
    // The mock ignores the month param, so the same seeded figures come
    // back — this proves the reload cycle completes cleanly, not just that
    // the input accepted a new value.
    await expect(page.getByRole('heading', { name: 'Business snapshot', exact: true })).toBeVisible();
    await expect(statValue(page, 'month-loads')).toHaveText('1561');
  });
});

test.describe('home — module-level access', () => {
  test('OPS gets a read-only badge (VIEW-level on home)', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/home');
    await expect(page.getByTestId('view-only')).toBeVisible();
  });

  // Operations went VIEW -> EDIT on `home` when it absorbed the branch
  // manager, so it gets the monthly review with no read-only badge — and,
  // carrying no branch, it sees every branch rather than one.
  test('Operations (EDIT-level) has no read-only badge and sees every branch', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/home');
    await expect(page.getByTestId('view-only')).toHaveCount(0);
    await showFullDetail(page);

    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'How each branch did' }) });
    await expect(panel.locator('tbody tr')).toHaveCount(5);
    await expect(panel.getByText('Nashik', { exact: true })).toBeVisible();
    await expect(panel.getByText('Pune', { exact: true })).toBeVisible();
  });
});
