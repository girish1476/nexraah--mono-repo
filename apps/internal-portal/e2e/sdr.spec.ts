import { Locator, Page, test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * SDR — `/sdr`: shortage and damage records (SDR).
 *
 * A record puts the trip's final payment on hold. Resolving it fixes the
 * amount taken from the transporter, and the payment goes out after that
 * deduction; a deduction bigger than what is left to pay carries to the
 * transporter's next orders.
 *
 * Fixture: 120855 (delivered, proof of delivery approved, ₹19,040 to pay).
 * One role (ADMIN) runs the whole path, because a hard navigation would reset
 * the in-browser fixture and undo the very records this test creates.
 */

function fieldControl(scope: Page | Locator, label: string) {
  return scope.locator('div.field').filter({ hasText: label }).locator('input, select, textarea');
}

const dialog = (page: Page, title: string | RegExp) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: title }) });

const row = (page: Page, text: string) => page.locator('table.table tbody tr').filter({ hasText: text });

// A sidebar group stays open once opened, so only click it when the link is hidden.
// The click is retried until the URL moves: on a busy `next dev` a client-side
// navigation can be swallowed by a route still compiling.
async function openNav(page: Page, group: RegExp, link: RegExp, url: RegExp) {
  const target = page.getByRole('link', { name: link });
  if (!(await target.isVisible())) await page.getByRole('button', { name: group }).click();
  await expect(async () => {
    await target.click();
    await expect(page).toHaveURL(url, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}

test.describe('shortage and damage', () => {
  test('an open record holds the payment; resolving it pays after the deduction and carries the excess forward', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await setRole(page, 'ADMIN');
    await page.goto('/sdr');
    await expect(page.getByText('No payments on hold')).toBeVisible();

    // Record a shortage on a delivered trip.
    await page.getByRole('button', { name: 'Record shortage or damage' }).click();
    let form = dialog(page, 'Record shortage or damage');
    await fieldControl(form, 'Trip').selectOption('t-120855');
    await fieldControl(form, 'Details').fill('Eleven bundles short at the unloading gate');
    await fieldControl(form, 'Claimed amount').fill('25000');
    await form.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByText(/SDR-\d+ recorded/)).toBeVisible();
    await expect(row(page, '120855')).toContainText('Payment on hold');
    await expect(page.getByTestId('sdr-open')).toContainText('1');

    // The trip's payment is held while it is open.
    await openNav(page, /^Payments/, /^Final payments/, /\/payments\/balance$/);
    await expect(page).toHaveURL(/\/payments\/balance$/);
    await expect(row(page, '120855').locator('td[data-label="Can we pay yet?"]')).toHaveText('1 unmet');
    await row(page, '120855').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText('1 shortage or damage record is still open')).toBeVisible();

    // Resolve it for more than the payment: the whole payment is taken, and the rest carries.
    await openNav(page, /^Supply/, /^SDR/, /\/sdr$/);
    await expect(page).toHaveURL(/\/sdr$/);
    await row(page, '120855').getByRole('button', { name: 'Resolve' }).click();
    form = dialog(page, /^Resolve SDR-/);
    await fieldControl(form, 'Amount to deduct').fill('25000');
    await form.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText(/resolved — ₹25,000 comes off the payment/)).toBeVisible();

    await page.getByRole('tab', { name: /Still to recover/ }).click();
    await expect(row(page, '120855')).toContainText('₹25,000');

    // The payment now goes out after the deduction: nothing left to pay this time.
    await openNav(page, /^Payments/, /^Final payments/, /\/payments\/balance$/);
    const r = row(page, '120855');
    await expect(r.locator('td[data-label="Can we pay yet?"]')).toHaveText('Releasable');
    await expect(r.locator('td[data-label="Shortage / damage"]')).toHaveText('₹18,990');
    await expect(r.locator('td[data-label="Amount to pay"]')).toHaveText('₹50');
    await r.getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText(/Less shortage \/ damage SDR-/)).toBeVisible();
    await expect(page.getByText(/₹6,010 is more than this payment — it carries to their next orders/)).toBeVisible();

    // What is left to recover is the transporter's negative balance; Compliance can
    // write it off, but only on Leadership's mail, which is recorded with the waiver.
    await openNav(page, /^Supply/, /^SDR/, /\/sdr$/);
    await page.getByRole('tab', { name: /Still to recover/ }).click();
    await expect(row(page, '120855')).toContainText('still to recover');
    await row(page, '120855').getByRole('button', { name: 'Waive balance' }).click();
    const waiver = dialog(page, /^Waive what is left/);
    const confirmWaiver = waiver.getByRole('button', { name: 'Waive balance' });
    await expect(confirmWaiver).toBeDisabled();
    await waiver.locator('input').first().fill('RE: SDR write-off approved by Leadership');
    await expect(confirmWaiver).toBeEnabled();
    await confirmWaiver.click();
    await expect(page.getByText(/what was left to recover is waived/)).toBeVisible();
    await expect(page.getByText('Nothing carried forward')).toBeVisible();
  });

  test('a resolved record smaller than the payment just reduces what is paid', async ({ page }) => {
    test.setTimeout(90_000);
    await setRole(page, 'ADMIN');
    await page.goto('/sdr');
    await page.getByRole('button', { name: 'Record shortage or damage' }).click();
    let form = dialog(page, 'Record shortage or damage');
    await fieldControl(form, 'Trip').selectOption('t-120855');
    await fieldControl(form, 'What happened').selectOption('DAMAGE');
    await fieldControl(form, 'Details').fill('Two cartons crushed in transit');
    await form.getByRole('button', { name: 'Record' }).click();
    await expect(page.getByText(/SDR-\d+ recorded/)).toBeVisible();

    await row(page, '120855').getByRole('button', { name: 'Resolve' }).click();
    form = dialog(page, /^Resolve SDR-/);
    await fieldControl(form, 'Amount to deduct').fill('4000');
    await form.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText(/resolved — ₹4,000 comes off the payment/)).toBeVisible();

    await openNav(page, /^Payments/, /^Final payments/, /\/payments\/balance$/);
    const r = row(page, '120855');
    await expect(r.locator('td[data-label="Shortage / damage"]')).toHaveText('₹4,000');
    await expect(r.locator('td[data-label="Amount to pay"]')).toHaveText('₹15,040');
  });

  test('Finance can see the records but not record or resolve one', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/sdr');
    await expect(page.getByRole('heading', { name: 'SDR' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record shortage or damage' })).toHaveCount(0);
  });
});
