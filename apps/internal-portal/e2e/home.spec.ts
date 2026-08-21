import { test, expect, Page } from '@playwright/test';
import { setRole } from './helpers';

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
 * BRANCH_MGR is scoped to Nashik only (`scopeBranch`), so its branch table
 * has one row and its POD "pending" count reflects only Nashik's trip.
 */

const stat = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..').locator('.stat-value');

test.describe('home — leadership dashboard (LEADERSHIP, unscoped)', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/home');
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
  });

  test('"This month" stat strip shows the aggregated seeded figures', async ({ page }) => {
    await expect(stat(page, 'Trips')).toHaveText('1561');
    await expect(stat(page, 'Revenue')).toHaveText('₹7.50 Cr');
    await expect(stat(page, 'Transporter cost')).toHaveText('₹6.55 Cr');
    await expect(stat(page, 'Gross margin')).toHaveText('₹95.4 L');
    await expect(stat(page, 'Margin %')).toHaveText('12.7%');
    await expect(stat(page, 'Transporters used')).toHaveText('38');
  });

  test('the on-time / placement stat strip shows the seeded figures', async ({ page }) => {
    await expect(stat(page, 'On time')).toHaveText('91.4%');
    await expect(stat(page, 'Placed by pickup date')).toHaveText('1489');
    await expect(stat(page, 'Failures')).toHaveText('72');
    await expect(stat(page, 'Distinct trucks')).toHaveText('412');
  });

  test('branches table lists all five branches with the right columns', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Branches' }) });
    const headers = panel.locator('thead th');
    await expect(headers).toHaveText(['Branch', 'Trips', 'Revenue', 'Cost', 'Margin', '%', 'Share']);

    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(5);
    await expect(panel.getByText('Nashik', { exact: true })).toBeVisible();
    await expect(panel.getByText('Pune', { exact: true })).toBeVisible();
    await expect(panel.getByText('Vijayawada', { exact: true })).toBeVisible();
    await expect(panel.getByText('Gandhidham', { exact: true })).toBeVisible();
    await expect(panel.getByText('Hosur', { exact: true })).toBeVisible();
  });

  test('POD-collection stat strip shows the seeded figures', async ({ page }) => {
    await expect(stat(page, 'Delivered')).toHaveText('1488');
    await expect(stat(page, 'Collected')).toHaveText('1351');
    // Pending is computed from the (unscoped) trip fixture: 3 of the 4
    // seeded trips are delivered but not APPROVED/WAIVED.
    await expect(stat(page, 'Pending')).toHaveText('3');
    await expect(stat(page, 'Within turnaround')).toHaveText('1288');
    await expect(stat(page, 'Breached')).toHaveText('63');
    await expect(stat(page, 'Collection %')).toHaveText('90.8%');
    await expect(stat(page, 'Penalty accrued')).toHaveText('₹6,300');
  });

  test('"Where things stand" stat strip shows the seeded figures', async ({ page }) => {
    await expect(stat(page, 'Advance outstanding')).toHaveText('₹1.8 L');
    await expect(stat(page, 'Balance pending')).toHaveText('₹3.2 L');
    await expect(stat(page, 'Receivables')).toHaveText('₹14.5 L');
    await expect(stat(page, 'Unbilled trips')).toHaveText('41');
  });

  test('top clients panel lists the three seeded clients by revenue', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Top clients' }) });
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
    await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
    await expect(stat(page, 'Trips')).toHaveText('1561');
  });
});

test.describe('home — module-level access', () => {
  test('OPS gets a read-only badge (VIEW-level on home)', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/home');
    await expect(page.getByText('Read-only for OPS')).toBeVisible();
  });

  test('BRANCH_MGR (EDIT-level) has no read-only badge and sees only its own branch', async ({ page }) => {
    await setRole(page, 'BRANCH_MGR');
    await page.goto('/home');
    await expect(page.getByText(/Read-only for/)).toHaveCount(0);

    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Branches' }) });
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(1);
    await expect(panel.getByText('Nashik', { exact: true })).toBeVisible();

    // Nashik's one seeded trip is delivered but PENDING on POD.
    await expect(stat(page, 'Pending')).toHaveText('1');
  });
});
