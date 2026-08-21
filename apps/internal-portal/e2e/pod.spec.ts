import { test, expect, Page, Locator } from '@playwright/test';
import { setRole } from './helpers';

/**
 * POD — `/pod/pending`, `/pod/receiving`, `/pod/[id]/verify` (part 06).
 *
 * Module `pod`: COMPLIANCE and BRANCH_MGR are EDIT, OPS/FINANCE/LEADERSHIP
 * are VIEW, ADMIN is NONE. But module-level EDIT is not the same as holding
 * the named permission a control actually checks: `pod.waive` is a fixed
 * permission (BR-43) held only by COMPLIANCE (see SEED_GRANTS in
 * lib/permissions.ts), so BRANCH_MGR — EDIT on the module — still doesn't
 * get the "Propose waiver" button. Tests below assert the real
 * permission-gated behaviour rather than the module-level shorthand.
 *
 * Fixture trips relevant here (src/mocks/db.ts) — podStatus is fixed fixture
 * data, not derived from the clock, so it's asserted exactly. Age-derived
 * numbers (days left, penalty accrued on the *pending* list specifically)
 * drift with real time and are asserted loosely or not at all:
 *   TRP-120881 · Rathod Roadlines   · Nashik      · PENDING  · ageDays ~24
 *   TRP-120874 · Sai Kripa Carriers · Pune        · ATTACHED · ageDays ~31
 *   TRP-120869 · Bhagwati Logistics · Hosur       · RECEIVED · ageDays ~16
 *   TRP-120855 · Anand Roadways     · Gandhidham  · APPROVED · ageDays ~3
 * Turnaround is 20 days (pod_tat_days), forfeiture is 40 (pod_forfeit_days) —
 * all four ages sit comfortably clear of both boundaries.
 */

function statValue(page: Page, label: string) {
  return page.locator('.stat-strip > div').filter({ hasText: label }).locator('.stat-value');
}

function row(page: Page, tripCode: string) {
  return page.locator('table.table tbody tr').filter({ hasText: tripCode });
}

/** `Field` renders a bare `<label>` with no `for`/`id` (no `getByLabel` support). */
function field(scope: Page | Locator, label: string) {
  return scope.locator('.field').filter({ hasText: label });
}

/** The Dialog's content box is the heading's immediate parent — modal, so only one is ever open. */
function dialogFor(page: Page, title: string | RegExp) {
  return page.getByRole('heading', { name: title }).locator('xpath=..');
}

test.describe('POD pending list', () => {
  test('shows the stat strip and the chase list oldest-first', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/pending');

    await expect(statValue(page, 'Pending')).toHaveText('3');
    await expect(statValue(page, 'Breached')).toHaveText('2');
    // Balance held is buyRate minus advance paid — static fixture fields,
    // not derived from the clock, so this total is safe to pin exactly.
    await expect(statValue(page, 'Balance held')).toHaveText('₹81,920');

    const codes = await page.locator('table.table tbody tr td[data-label="Trip"] a').allTextContents();
    expect(codes).toEqual(['TRP-120874', 'TRP-120881', 'TRP-120869']);

    await expect(row(page, 'TRP-120874').getByText(/\+\d+d over/)).toBeVisible();
    await expect(row(page, 'TRP-120881').getByText(/\+\d+d over/)).toBeVisible();
    await expect(row(page, 'TRP-120869').getByText(/\d+ days left/)).toBeVisible();

    await expect(row(page, 'TRP-120881').locator('td[data-label="Balance held"]')).toHaveText('₹58,400');
  });

  test('branch and transporter filters narrow the list', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/pending');
    await expect(page.locator('table.table tbody tr')).toHaveCount(3);

    await field(page, 'Branch').locator('input').fill('Nashik');
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await expect(row(page, 'TRP-120881')).toBeVisible();

    await field(page, 'Branch').locator('input').fill('');
    await field(page, 'Transporter').locator('input').fill('Sai Kripa');
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await expect(row(page, 'TRP-120874')).toBeVisible();
  });

  test('the ageing filter buckets rows, and a filter with no matches shows the empty state', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/pending');

    await field(page, 'Ageing').locator('select').selectOption('within');
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await expect(row(page, 'TRP-120869')).toBeVisible();

    await field(page, 'Ageing').locator('select').selectOption('');
    await field(page, 'Branch').locator('input').fill('Not A Real Branch');
    await expect(page.getByText('Every proof of delivery is in.')).toBeVisible();
    await expect(page.locator('table.table')).toHaveCount(0);
  });

  test('COMPLIANCE sees "Propose waiver" only on rows with an unwaived penalty', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/pending');

    await expect(row(page, 'TRP-120874').getByRole('button', { name: 'Propose waiver' })).toBeVisible();
    await expect(row(page, 'TRP-120881').getByRole('button', { name: 'Propose waiver' })).toBeVisible();
    await expect(row(page, 'TRP-120869').getByRole('button', { name: 'Propose waiver' })).toHaveCount(0);
  });

  test('BRANCH_MGR has module-level EDIT but lacks the fixed pod.waive permission, so no waiver button renders', async ({
    page,
  }) => {
    await setRole(page, 'BRANCH_MGR');
    await page.goto('/pod/pending');

    // Branch-scoped to Nashik — only TRP-120881 is visible at all.
    await expect(page.locator('table.table tbody tr')).toHaveCount(1);
    await expect(row(page, 'TRP-120881')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Propose waiver' })).toHaveCount(0);
    // EDIT-level role: no read-only badge.
    await expect(page.getByText('Read-only for BRANCH_MGR')).toHaveCount(0);
  });

  test('OPS (VIEW) sees the read-only badge and no waiver button on any row', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/pod/pending');

    await expect(page.getByText('Read-only for OPS')).toBeVisible();
    await expect(page.locator('table.table tbody tr')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Propose waiver' })).toHaveCount(0);
  });

  test('proposing a waiver requires 30 characters and is routed to LEADERSHIP for approval', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/pending');

    await row(page, 'TRP-120874').getByRole('button', { name: 'Propose waiver' }).click();
    const dialog = dialogFor(page, 'Propose a penalty waiver');
    await expect(dialog.getByText('TRP-120874')).toBeVisible();
    await expect(dialog.getByText('Sai Kripa Carriers')).toBeVisible();

    const confirm = dialog.getByRole('button', { name: 'Request waiver' });
    await expect(confirm).toBeDisabled();
    await dialog.locator('textarea').fill('Too short');
    await expect(confirm).toBeDisabled();
    await dialog
      .locator('textarea')
      .fill('The transporter disputes the delay; branch confirms the depot was closed for a local holiday.');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('Sent to LEADERSHIP · the penalty keeps accruing until it is approved')).toBeVisible();
  });
});

test.describe('POD receiving register', () => {
  test('renders the stat strip and every delivered trip', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/receiving');

    await expect(statValue(page, 'Attached in transit')).toHaveText('1');
    await expect(statValue(page, 'Received today')).toHaveText('0');
    await expect(statValue(page, 'Awaiting verification')).toHaveText('1');
    await expect(statValue(page, 'Awaiting approval')).toHaveText('0');
    await expect(statValue(page, 'Balance held')).toHaveText('₹81,920');
    await expect(statValue(page, 'Past 20 days')).toHaveText('2');

    await expect(page.locator('table.table tbody tr')).toHaveCount(4);
    await expect(row(page, 'TRP-120881').getByRole('button', { name: 'Log a receipt' })).toBeVisible();
    await expect(row(page, 'TRP-120874').getByRole('button', { name: 'Log a receipt' })).toBeVisible();
    await expect(row(page, 'TRP-120869').getByRole('link', { name: 'Open' })).toBeVisible();
    await expect(row(page, 'TRP-120855').getByRole('link', { name: 'Open' })).toBeVisible();
  });

  test('a role without pod.receive sees read-only text instead of the log button', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/pod/receiving');

    await expect(page.getByText('Read-only for FINANCE')).toBeVisible();
    await expect(row(page, 'TRP-120881').getByText('Branch logs receipts')).toBeVisible();
    await expect(row(page, 'TRP-120881').getByRole('button', { name: 'Log a receipt' })).toHaveCount(0);
    // The verify page itself is still viewable — the "Open" link isn't permission-gated.
    await expect(row(page, 'TRP-120869').getByRole('link', { name: 'Open' })).toBeVisible();
  });

  test('logging a receipt stops the clock', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/receiving');

    await row(page, 'TRP-120881').getByRole('button', { name: 'Log a receipt' }).click();
    const dialog = dialogFor(page, 'Log a POD receipt');
    const confirm = dialog.getByRole('button', { name: 'Log receipt' });
    await expect(confirm).toBeDisabled();

    await field(dialog, 'Courier docket').locator('input').fill('CN-99182');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText(/logged · the clock has stopped for TRP-120881/)).toBeVisible();
    await expect(row(page, 'TRP-120881').getByRole('link', { name: 'Open' })).toBeVisible();
    await expect(row(page, 'TRP-120881').getByRole('button', { name: 'Log a receipt' })).toHaveCount(0);
  });
});

test.describe('POD verify and approve', () => {
  test('a role with pod.verify sees the document, facts and checklist', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/t-120869/verify');

    await expect(page.getByRole('heading', { name: /Proof of delivery · TRP-120869/ })).toBeVisible();
    await expect(page.getByText('RECEIVED', { exact: true })).toBeVisible();
    await expect(page.getByText('LR-88201')).toBeVisible();
    // The page header's subtitle also mentions the transporter's name — this
    // one is the exact match in the fact list.
    await expect(page.getByText('Bhagwati Logistics', { exact: true })).toBeVisible();
    await expect(page.getByText('Page 1')).toBeVisible();
    await expect(page.getByText('Page 2')).toBeVisible();

    for (const label of [
      'Consignee stamp present',
      'Signed and dated',
      'LR number matches',
      'Quantity matches the invoice',
      'No shortage or damage noted',
    ]) {
      await expect(page.getByText(label)).toBeVisible();
    }
    await expect(page.getByRole('button', { name: 'Verify' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Reject and request a replacement' })).toBeVisible();
    // No prior receiving-register entry was logged for this seeded trip.
    await expect(page.getByText('Receiving record')).toHaveCount(0);
  });

  test('the Verify button is disabled until remarks are given for a failed check', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/t-120869/verify');

    const verify = page.getByRole('button', { name: 'Verify' });
    await expect(verify).toBeEnabled();

    await page.getByText('No shortage or damage noted').click();
    await expect(verify).toBeDisabled();
    await expect(page.getByText('Remarks are mandatory when any check fails')).toBeVisible();

    await page.locator('textarea').first().fill('One carton corner crushed; consignee accepted with a remark on the LR.');
    await expect(verify).toBeEnabled();
  });

  test('verifying blocks the same user from approving their own proof (BR-50)', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/t-120869/verify');

    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('Verified · a second person must approve it (BR-50)')).toBeVisible();

    await expect(page.getByText('VERIFIED', { exact: true })).toBeVisible();
    await expect(page.getByText('You verified this proof of delivery')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0);
  });

  test('rejecting returns the proof to the transporter and the clock resumes (BR-52)', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/t-120869/verify');

    await page.getByRole('button', { name: 'Reject and request a replacement' }).click();
    const dialog = dialogFor(page, 'Reject this proof of delivery');
    const confirm = dialog.getByRole('button', { name: 'Reject' });
    await expect(confirm).toBeDisabled();
    await dialog.locator('textarea').fill('Signature missing on the consignee copy.');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.getByText('Rejected · returned to the transporter and the clock resumes (BR-52)')).toBeVisible();
    await expect(page.getByText('The physical copy has not been logged')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0);
  });

  test('a VIEW-only role sees the document but no verify controls', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/pod/t-120869/verify');

    await expect(page.getByText('Read-only for FINANCE')).toBeVisible();
    await expect(page.getByText('Page 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Reject and request a replacement' })).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  });

  test('an approved proof shows the closed banner, not verify or approve controls', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await page.goto('/pod/t-120855/verify');

    await expect(page.getByText('APPROVED', { exact: true })).toBeVisible();
    await expect(page.getByText('The balance is unblocked. Finance still releases it')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });
});
