import { test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * `/today` — three working queues plus a POD/issue panel (part 10 §1). Fixture
 * data (`src/mocks/db.ts`) seeds four indents and four trips; the numbers
 * below are derived from that fixture, not guessed:
 *
 *  - OPEN indents: IND-4471, IND-4468, IND-4462 (IND-4443 is TRIP_CREATED).
 *    Of those, IND-4468's pickup date is in the past → the one placement
 *    failure, cause ONLY_ABOVE_BAND_QUOTES.
 *  - Trips delivered but not APPROVED/WAIVED on POD: TRP-120881, TRP-120874,
 *    TRP-120869 (TRP-120855 is APPROVED, so it is excluded).
 *  - Vendor issues not RESOLVED: IS-0041, IS-0042 (IS-0043 is RESOLVED).
 *
 * BRANCH_MGR is scoped to Nashik (`scopeBranch`). Nashik's only indent
 * (IND-4443) isn't OPEN, so BRANCH_MGR sees empty allocation/failure panels
 * while POD overdue (TRP-120881) and vendor issues (not branch-scoped) still
 * show rows — a real empty-state case distinct from the ADMIN lock panel
 * already covered by rbac-nav.spec.ts.
 */

test.describe('today — stat strip and queues (OPS, unscoped)', () => {
  test.beforeEach(async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  });

  test('pending-allocation stat strip renders real seeded numbers', async ({ page }) => {
    const stat = (label: string) => page.getByText(label, { exact: true }).locator('..').locator('.stat-value');
    await expect(stat('Waiting')).toHaveText('3');
    await expect(stat('Freight at stake')).toHaveText('₹1.4 L');
    await expect(stat('No quotes yet')).toHaveText('1');
    await expect(stat('Quotes in')).toHaveText('4');
    await expect(stat('Tonnes')).toHaveText('60');
    // Earliest pickup is relative to "now" in the fixture — assert it
    // resolved to a real date, not the "—" placeholder for a null value.
    await expect(stat('Earliest pickup')).not.toHaveText('—');
  });

  test('placement-failures stat strip and cause tag match the one seeded failure', async ({ page }) => {
    const stat = (label: string) => page.getByText(label, { exact: true }).locator('..').locator('.stat-value');
    await expect(stat('Failed')).toHaveText('1');
    await expect(stat('Freight lost')).toHaveText('₹39,000');
    await expect(stat('Never quoted')).toHaveText('0');

    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Placement failures' }) });
    await expect(panel.getByText('IND-4468')).toBeVisible();
    await expect(panel.getByText('Only above-band quotes')).toBeVisible();
    await expect(panel.getByText('recruitment problem')).toBeVisible();
  });

  test('trips pending allocation lists the three open indents with the right columns', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Trips pending allocation' }) });
    const headers = panel.locator('thead th');
    await expect(headers).toHaveText(['Indent', 'Client', 'Lane', 'Load', 'Pickup', 'Freight', 'Quotes', 'Branch']);

    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(panel.getByRole('link', { name: 'IND-4471' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'IND-4468' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'IND-4462' })).toBeVisible();
  });

  test('POD overdue lists the three trips still open on POD, not the approved one', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'POD overdue' }) });
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(panel.getByRole('link', { name: 'TRP-120881' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'TRP-120874' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'TRP-120869' })).toBeVisible();
    await expect(panel.getByRole('link', { name: 'TRP-120855' })).toHaveCount(0);
  });

  test('vendor issues lists the two open issues, not the resolved one', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Vendor issues' }) });
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(panel.getByText('IS-0041')).toBeVisible();
    await expect(panel.getByText('IS-0042')).toBeVisible();
    await expect(panel.getByText('IS-0043')).toHaveCount(0);
    await expect(panel.getByText('HIGH')).toBeVisible();
    await expect(panel.getByText('MEDIUM')).toBeVisible();
  });

  test('the market-gap link points at /vendors/market-gap', async ({ page }) => {
    const link = page.getByRole('link', { name: /Market gap/ });
    await expect(link).toHaveAttribute('href', '/vendors/market-gap');
  });

  test('clicking an indent code in pending allocation opens the indent detail page', async ({ page }) => {
    await page.getByRole('link', { name: 'IND-4471' }).click();
    await expect(page).toHaveURL(/\/indents\/i-4471$/);
    await expect(page.getByRole('heading', { name: 'IND-4471', exact: true })).toBeVisible();
  });

  test('clicking a trip code in POD overdue opens the trip detail page', async ({ page }) => {
    await page.getByRole('link', { name: 'TRP-120881' }).click();
    await expect(page).toHaveURL(/\/trips\/t-120881$/);
    await expect(page.getByRole('heading', { name: 'TRP-120881', exact: true })).toBeVisible();
  });
});

test.describe('today — branch scoping empty state (BRANCH_MGR)', () => {
  test('Nashik has no open indents: allocation and failure panels go empty, POD/issues do not', async ({ page }) => {
    await setRole(page, 'BRANCH_MGR');
    await page.goto('/today');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

    await expect(page.getByText('Everything is placed.')).toBeVisible();
    await expect(page.getByText('No placement failures.')).toBeVisible();

    // Not branch-limited to zero: BRANCH_MGR still has its own POD-overdue
    // trip and the (unscoped) vendor issues queue.
    const podPanel = page.locator('.surface', { has: page.getByRole('heading', { name: 'POD overdue' }) });
    await expect(podPanel.locator('tbody tr')).toHaveCount(1);
    await expect(podPanel.getByRole('link', { name: 'TRP-120881' })).toBeVisible();

    const issuesPanel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Vendor issues' }) });
    await expect(issuesPanel.locator('tbody tr')).toHaveCount(2);
  });
});
