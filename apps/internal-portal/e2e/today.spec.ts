import { test, expect } from '@playwright/test';
import { setRole, statValue } from './helpers';

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
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('pending-allocation stat strip renders real seeded numbers', async ({ page }) => {
    
    await expect(statValue(page, 'today-waiting')).toHaveText('3');
    await expect(statValue(page, 'today-freight-at-stake')).toHaveText('₹1.4 L');
    await expect(statValue(page, 'today-no-quotes')).toHaveText('1');
    await expect(statValue(page, 'today-quotes-in')).toHaveText('4');
    await expect(statValue(page, 'today-tonnes')).toHaveText('60');
    // Earliest pickup is relative to "now" in the fixture — assert it
    // resolved to a real date, not the "—" placeholder for a null value.
    await expect(statValue(page, 'today-earliest-pickup')).not.toHaveText('—');
  });

  test('placement-failures stat strip and cause tag match the one seeded failure', async ({ page }) => {
    
    await expect(statValue(page, 'today-failed')).toHaveText('1');
    await expect(statValue(page, 'today-freight-lost')).toHaveText('₹39,000');
    await expect(statValue(page, 'today-never-quoted')).toHaveText('0');

    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Loads we could not place' }) });
    await expect(panel.getByText('IND-4468')).toBeVisible();
    await expect(panel.getByText('Every quote came in above our price limit')).toBeVisible();
    await expect(panel.getByText('recruit on that route')).toBeVisible();
  });

  test('trips pending allocation lists the three open indents with the right columns', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Loads waiting for a transporter' }) });
    const headers = panel.locator('thead th');
    await expect(headers).toHaveText([
      'Client and route',
      'Pick up on',
      'Worth',
      'Transporter quotes',
      'Branch',
      '',
    ]);

    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(panel.getByText('IND-4471')).toBeVisible();
    await expect(panel.getByText('IND-4468')).toBeVisible();
    await expect(panel.getByText('IND-4462')).toBeVisible();
  });

  test('POD overdue lists the three trips still open on POD, not the approved one', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'still missing their signed paperwork' }) });
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(panel.getByText('TRP-120881')).toBeVisible();
    await expect(panel.getByText('TRP-120874')).toBeVisible();
    await expect(panel.getByText('TRP-120869')).toBeVisible();
    await expect(panel.getByText('TRP-120855')).toHaveCount(0);
  });

  test('vendor issues lists the two open issues, not the resolved one', async ({ page }) => {
    const panel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Open problems with transporters' }) });
    const rows = panel.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(panel.getByText('IS-0041')).toBeVisible();
    await expect(panel.getByText('IS-0042')).toBeVisible();
    await expect(panel.getByText('IS-0043')).toHaveCount(0);
    await expect(panel.getByText('Urgent')).toBeVisible();
    await expect(panel.getByText('Needs attention')).toBeVisible();
  });

  test('the market-gap link points at /vendors/market-gap', async ({ page }) => {
    const link = page.getByRole('link', { name: /short of trucks/ }).first();
    await expect(link).toHaveAttribute('href', '/vendors/market-gap');
  });

  test('a row in the waiting queue opens the load request behind it', async ({ page }) => {
    const panel = page.locator('.surface', {
      has: page.getByRole('heading', { name: 'Loads waiting for a transporter' }),
    });
    await panel.locator('tbody tr').filter({ hasText: 'IND-4471' }).getByRole('link', { name: 'Open' }).click();
    // `waitForURL` with a long fuse, not `toHaveURL`: the first open of
    // /indents/[id] in a run compiles the route, and with the suite running
    // fullyParallel several workers queue behind that one dev-server
    // compile. It is harness latency, not the console being slow — these
    // two navigations pass comfortably when the file runs on its own.
    await page.waitForURL(/\/indents\/i-4471$/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'IND-4471', exact: true })).toBeVisible();
  });

  test('a row in the delivery-paperwork queue opens the trip behind it', async ({ page }) => {
    const panel = page.locator('.surface', {
      has: page.getByRole('heading', { name: 'still missing their signed paperwork' }),
    });
    await panel.locator('tbody tr').filter({ hasText: 'TRP-120881' }).getByRole('link', { name: 'Open' }).click();
    await page.waitForURL(/\/trips\/t-120881$/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'TRP-120881', exact: true })).toBeVisible();
  });
});

test.describe('today — branch scoping empty state (BRANCH_MGR)', () => {
  test('Nashik has no open indents: allocation and failure panels go empty, POD/issues do not', async ({ page }) => {
    await setRole(page, 'BRANCH_MGR');
    await page.goto('/today');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await expect(
      page.locator('.surface', {
        has: page.getByRole('heading', { name: 'Loads waiting for a transporter' }),
      }),
    ).toHaveCount(0);
    await expect(
      page.locator('.surface', { has: page.getByRole('heading', { name: 'Loads we could not place' }) }),
    ).toHaveCount(0);

    // Not branch-limited to zero: BRANCH_MGR still has its own POD-overdue
    // trip and the (unscoped) vendor issues queue.
    const podPanel = page.locator('.surface', { has: page.getByRole('heading', { name: 'still missing their signed paperwork' }) });
    await expect(podPanel.locator('tbody tr')).toHaveCount(1);
    await expect(podPanel.getByText('TRP-120881')).toBeVisible();

    const issuesPanel = page.locator('.surface', { has: page.getByRole('heading', { name: 'Open problems with transporters' }) });
    await expect(issuesPanel.locator('tbody tr')).toHaveCount(2);
  });
});
