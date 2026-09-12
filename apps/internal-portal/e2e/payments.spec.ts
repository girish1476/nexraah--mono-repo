import { test, expect, Page, Locator } from '@playwright/test';
import { setRole, statValue } from './helpers';

/**
 * Payments — `/payments/advance`, `/payments/balance`, `/payments/bills`
 * (part 07). Module `payments`: COMPLIANCE, FINANCE and LEADERSHIP are EDIT;
 * OPS and BD are VIEW; no internal role is NONE. (This previously read
 * "FINANCE alone is EDIT; OPS and LEADERSHIP are VIEW; OPS and COMPLIANCE are
 * NONE" — which named OPS twice at two different levels, residue of the
 * mechanical BRANCH_MGR→OPS rename.) `payment.release` is a fixed
 * permission (BR-40) that only FINANCE ever holds, so these tests focus on
 * what FINANCE can actually do — including the cases where FINANCE, too, is
 * blocked by the gate — and what a VIEW role sees instead.
 *
 * The gate components (`AdvancePanel`/`BalancePanel`) render whatever the
 * server names as unmet; nothing is computed in the browser (lib/ui.tsx
 * `BlockedPanel`). Fixture trips (src/mocks/db.ts):
 *   TRP-120881 · Rathod Roadlines   · Nashik      · PENDING  · advance unpaid
 *   TRP-120874 · Sai Kripa Carriers · Pune        · ATTACHED · advance paid
 *   TRP-120869 · Bhagwati Logistics · Hosur       · RECEIVED · advance paid
 *   TRP-120855 · Anand Roadways     · Gandhidham  · APPROVED · advance paid
 * Only TRP-120881 has its advance still unpaid, so it is the only row on the
 * advance queue. All four have an unpaid balance, so all four are on the
 * balance queue — and TRP-120855, the only approved POD, is the only
 * balance row that isn't gate-blocked. The money figures below come from
 * static fixture fields (buy rate, advance paid, `podPenaltyPaise`), not
 * from the clock, so they're pinned exactly; day counts derived from
 * "now minus deliveredAt" are asserted loosely.
 */


function row(page: Page, text: string) {
  return page.locator('table.table tbody tr').filter({ hasText: text });
}

/** `Field` renders a bare `<label>` with no `for`/`id` (no `getByLabel` support). */
function field(scope: Page | Locator, label: string) {
  return scope.locator('.field').filter({ hasText: label });
}

/** The Dialog's content box is the heading's immediate parent — modal, so only one is ever open. */
function dialogFor(page: Page, title: string | RegExp) {
  return page.getByRole('heading', { name: title }).locator('xpath=..');
}

test.describe('Advance', () => {
  test('renders the stat strip and the one trip whose advance is unpaid', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/advance');

    await expect(statValue(page, 'advance-waiting')).toHaveText('1');
    await expect(statValue(page, 'advance-ready')).toHaveText('0');
    await expect(statValue(page, 'advance-held')).toHaveText('1');
    await expect(statValue(page, 'advance-ready-value')).toHaveText('₹0');

    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    const r = row(page, 'TRP-120881');
    await expect(r.locator('td[data-label="Load request"]')).toHaveText('IND-4443');
    await expect(r.locator('td[data-label="Transporter"]')).toHaveText('Rathod Roadlines');
    await expect(r.locator('td[data-label="Advance amount"]')).toHaveText('40%');
    await expect(r.locator('td[data-label="Amount"]')).toHaveText('₹23,360');
    await expect(r.locator('td[data-label="Can we pay yet?"]')).toHaveText('3 unmet');
  });

  test('FINANCE can see exactly what is missing and what has cleared, but release stays disabled behind the document gate', async ({
    page,
  }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/advance');
    await row(page, 'TRP-120881').getByRole('button', { name: 'Open' }).click();

    await expect(page.getByText('Advance blocked')).toBeVisible();
    const panel = page.locator('.surface', { hasText: 'Advance blocked' }).first();
    await expect(panel).toContainText('₹23,360');
    await expect(panel).toContainText('40% of ₹58,400');

    for (const label of [
      'E-way bill not uploaded',
      'Registration certificate uploaded but not verified',
      'Driving licence not uploaded',
    ]) {
      await expect(panel.getByText(label)).toBeVisible();
    }
    for (const label of [
      'Client invoice or purchase order',
      'Goods insurance',
      'Fitness certificate',
      'National permit',
      'Pollution certificate',
    ]) {
      await expect(panel.getByText(label)).toBeVisible();
    }

    const release = page.getByRole('button', { name: 'Release ₹23,360' });
    await expect(release).toBeVisible();
    await expect(release).toBeDisabled();
    await expect(page.getByText('Release stays disabled until every item above is verified')).toBeVisible();
  });

  test('Operations (VIEW) sees the same blocked gate with no release control at all', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/payments/advance');
    // Branch-scoped to Nashik — TRP-120881 is Nashik, so it's still there.
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await row(page, 'TRP-120881').getByRole('button', { name: 'Open' }).click();

    await expect(page.getByText('Advance blocked')).toBeVisible();
    await expect(page.getByRole('button', { name: /Release/ })).toHaveCount(0);
    await expect(
      page.getByText('Release is a FINANCE action. You can see what is held and why, and clear what is yours to clear.'),
    ).toBeVisible();
  });
});

test.describe('Balance', () => {
  test('renders the stat strip and every trip with an unpaid balance', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/balance');

    await expect(statValue(page, 'balance-waiting')).toHaveText('4');
    await expect(statValue(page, 'balance-ready')).toHaveText('1');
    await expect(statValue(page, 'balance-held-for-pod')).toHaveText('3');
    await expect(statValue(page, 'balance-late-penalties')).toHaveText('₹1,500');
    await expect(page.locator('table.table tbody tr')).toHaveCount(4);
  });

  test('a blocked row names the unapproved proof of delivery, and the release stays disabled', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/balance');

    const r = row(page, 'TRP-120881');
    await expect(r.locator('td[data-label="Amount to pay"]')).toHaveText('₹59,800');
    await expect(r.locator('td[data-label="Can we pay yet?"]')).toHaveText('1 unmet');
    await r.getByRole('button', { name: 'Open' }).click();

    await expect(page.getByText('Balance blocked')).toBeVisible();
    const panel = page.locator('.surface', { hasText: 'Balance blocked' }).first();
    await expect(panel).toContainText('₹59,800 net');
    await expect(panel).toContainText('proof of delivery is pending');
    await expect(panel.getByText('Proof of delivery is pending, not approved')).toBeVisible();

    await expect(page.getByText('Billable — buy rate plus captured charges')).toBeVisible();
    await expect(page.getByText('₹60,200')).toBeVisible();
    await expect(page.getByText('−₹0')).toBeVisible();
    await expect(page.getByText(/Less POD penalty \(\d+ days?\)/)).toBeVisible();
    await expect(page.getByText('−₹400')).toBeVisible();
    await expect(page.getByText('₹100/day beyond 20 days')).toBeVisible();
    // "Net payable" also appears as the list table's column header — scope
    // to the open panel to match only the breakdown's fact row.
    await expect(panel.getByText('Net payable')).toBeVisible();

    const release = page.getByRole('button', { name: 'Release ₹59,800' });
    await expect(release).toBeVisible();
    await expect(release).toBeDisabled();
    await expect(page.getByText('Only an approved proof of delivery unblocks this.')).toBeVisible();
  });

  test('a releasable row can actually be released by FINANCE, and then leaves the queue', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/balance');

    const r = row(page, 'TRP-120855');
    await expect(r.locator('td[data-label="Can we pay yet?"]')).toHaveText('Releasable');
    await r.getByRole('button', { name: 'Open' }).click();

    await expect(page.getByText('Balance ready to release')).toBeVisible();
    const release = page.getByRole('button', { name: 'Release ₹19,040' });
    await expect(release).toBeEnabled();
    await release.click();

    const dialog = dialogFor(page, 'Release balance');
    await expect(dialog).toContainText('Anand Roadways');
    await expect(dialog).toContainText('₹19,040');
    const confirm = dialog.getByRole('button', { name: 'Confirm release' });
    await expect(confirm).toBeDisabled();
    await field(dialog, 'UTR').locator('input').fill('UTR778899');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('Balance released · ₹19,040 · UTR UTR778899')).toBeVisible();
    await expect(page.locator('table.table tbody tr')).toHaveCount(3);
    await expect(row(page, 'TRP-120855')).toHaveCount(0);
    await expect(statValue(page, 'balance-ready')).toHaveText('0');
  });

  // Re-pointed from LEADERSHIP to BD. Leadership was deliberately raised to
  // EDIT on payments so it can work the advance and balance gates, so the
  // read-only badge is genuinely absent for them — but relaxing the assertion
  // would have left the badge on this module covered by nothing at all.
  // BD is VIEW here and unscoped (`u-bd`, branch: null), so every assertion
  // below holds verbatim: four rows, the badge, and no release control.
  test('BD (VIEW, not branch-scoped) sees all four rows and the gate, with no release control', async ({
    page,
  }) => {
    await setRole(page, 'BD');
    await page.goto('/payments/balance');

    await expect(page.getByTestId('view-only')).toBeVisible();
    await expect(page.locator('table.table tbody tr')).toHaveCount(4);

    await row(page, 'TRP-120881').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText('Balance blocked')).toBeVisible();
    await expect(page.getByRole('button', { name: /Release/ })).toHaveCount(0);
    await expect(
      page.getByText('Release is a FINANCE action. Approving the proof of delivery is what unblocks it.'),
    ).toBeVisible();
  });

  /**
   * BR-40 in the shape the Leadership widening gave it, which nothing else
   * covers.
   *
   * Before, Leadership was VIEW on payments and the screen itself was the
   * barrier — "can they even open it" and "can they pay" were the same
   * question. Now they hold EDIT: the screen unlocks, the rows are all there,
   * and the *only* thing standing between Leadership and releasing money is
   * `payment.release` being absent from their grants. That is a strictly more
   * dangerous arrangement than the one it replaced, and it deserves to be
   * asserted by name rather than inferred from a badge that is now absent for
   * an unrelated reason.
   */
  test('LEADERSHIP holds EDIT on payments but still cannot release', async ({ page }) => {
    await setRole(page, 'LEADERSHIP');
    await page.goto('/payments/balance');

    // EDIT, so no read-only badge and the screen is fully open to them.
    await expect(page.getByTestId('view-only')).toHaveCount(0);
    await expect(page.locator('table.table tbody tr')).toHaveCount(4);

    await row(page, 'TRP-120881').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText('Balance blocked')).toBeVisible();
    // The line that matters: open screen, no release control.
    await expect(page.getByRole('button', { name: /Release/ })).toHaveCount(0);
    await expect(
      page.getByText('Release is a FINANCE action. Approving the proof of delivery is what unblocks it.'),
    ).toBeVisible();
  });
});

test.describe('Transporter bills', () => {
  test('renders the stat strip and both submitted bills', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/bills');

    await expect(statValue(page, 'bill-submitted')).toHaveText('2');
    await expect(statValue(page, 'bill-variance')).toHaveText('1');
    await expect(statValue(page, 'bill-queried')).toHaveText('0');
    await expect(statValue(page, 'bill-value')).toHaveText('₹72,900');

    const noVariance = row(page, 'AR/26/0221');
    await expect(noVariance.locator('td[data-label="Bill total"]')).toHaveText('₹30,800');
    await expect(noVariance.locator('td[data-label="Computed balance"]')).toHaveText('₹19,040');
    await expect(noVariance.locator('td[data-label="Variance"]')).toHaveText('—');

    const withVariance = row(page, 'BL/26/1180');
    await expect(withVariance.locator('td[data-label="Bill total"]')).toHaveText('₹42,100');
    await expect(withVariance.locator('td[data-label="Variance"]')).toHaveText('₹900 · 2.1%');
  });

  test('accepting at the computed figure needs no reason and releases immediately', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/bills');

    await row(page, 'AR/26/0221').getByRole('button', { name: 'Accept' }).click();
    const dialog = dialogFor(page, 'Accept this bill');
    await expect(dialog).toContainText('Anand Roadways');
    const confirm = dialog.getByRole('button', { name: 'Accept and release' });
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('Accepted at the computed figure · ₹19,040')).toBeVisible();
    await expect(row(page, 'AR/26/0221').getByText('ACCEPTED')).toBeVisible();
    await expect(row(page, 'AR/26/0221').getByRole('button', { name: 'Accept' })).toHaveCount(0);
  });

  test('accepting at the transporter’s own figure requires a reason first', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/bills');

    await row(page, 'BL/26/1180').getByRole('button', { name: 'Accept' }).click();
    const dialog = dialogFor(page, 'Accept this bill');
    const confirm = dialog.getByRole('button', { name: 'Accept and release' });
    await expect(confirm).toBeEnabled();

    await dialog.getByText('Accept at their figure instead of ours').click();
    await expect(confirm).toBeDisabled();
    await dialog.locator('textarea').fill('Transporter quoted a higher detention charge; branch confirms it.');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('Accepted at the transporter’s figure · ₹42,100')).toBeVisible();
  });

  test('querying a bill notifies the transporter and leaves it open', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/payments/bills');

    await row(page, 'AR/26/0221').getByRole('button', { name: 'Query' }).click();
    const dialog = dialogFor(page, 'Query this bill');
    const confirm = dialog.getByRole('button', { name: 'Send query' });
    await expect(confirm).toBeDisabled();
    await dialog.locator('textarea').fill('Please clarify the loading charge line item.');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('Queried · the transporter has been notified and the bill stays open')).toBeVisible();
    await expect(row(page, 'AR/26/0221').getByText('Sent back with a question')).toBeVisible();
  });

  test('a VIEW-only role sees the bills but no accept or query controls', async ({ page }) => {
    // BD, not LEADERSHIP — see the balance test above. `/payments/bills` is
    // not branch-scoped, so the two-row count holds for any unscoped caller.
    await setRole(page, 'BD');
    await page.goto('/payments/bills');

    await expect(page.getByTestId('view-only')).toBeVisible();
    await expect(page.locator('table.table tbody tr')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Accept' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Query' })).toHaveCount(0);
    await expect(page.getByText('Finance decides', { exact: true })).toHaveCount(2);
  });
});
