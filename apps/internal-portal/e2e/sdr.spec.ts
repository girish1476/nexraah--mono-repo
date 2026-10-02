import { Locator, Page, test, expect } from '@playwright/test';
import { openMobileMenu, setRole } from './helpers';

/**
 * SDR — `/sdr`: shortage and damage records (SDR).
 *
 * A record puts the trip's final payment on hold. Resolving it fixes the
 * amount taken from the transporter, and the payment goes out after that
 * deduction; a deduction bigger than what is left to pay carries to the
 * transporter's next orders.
 *
 * A record is never entered by hand: it is raised by the check of a proof of
 * delivery. Fixture: 120869 (delivered, proof received and not yet checked).
 * One role (ADMIN) runs the whole path — verify, approve, resolve — because a
 * hard navigation would reset the in-browser fixture and undo the very
 * records this test creates.
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
  // The menu's own link — a page may carry an inline link of the same name.
  const target = page.getByRole('navigation').getByRole('link', { name: link });
  await openMobileMenu(page);
  if (!(await target.isVisible())) await page.getByRole('button', { name: group }).click();
  await expect(async () => {
    await target.click();
    await expect(page).toHaveURL(url, { timeout: 5_000 });
  }).toPass({ timeout: 45_000 });
}

/**
 * The only way a record comes to exist: a shortage or damage ticked while the
 * proof of delivery is verified. ADMIN verifies and approves 120869 in one go.
 */
async function verifyWithFinding(page: Page, kind: 'shortage' | 'damage', description: string, rupees?: string) {
  await page.goto('/pod/t-120869/verify');
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await page.getByText(kind === 'shortage' ? 'Fewer goods arrived than were sent' : 'Goods arrived damaged').click();
  await page.getByPlaceholder(kind === 'shortage' ? /bags short/ : /drums dented/).fill(description);
  if (rupees) await fieldControl(page, 'Believed to cost').fill(rupees);
  await page.getByRole('button', { name: 'Verify', exact: true }).last().click();
  await expect(page.getByText(/Verified · SDR-\d+ raised/)).toBeVisible();
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText(/Approved · the balance is unblocked/)).toBeVisible();
}

test.describe('shortage and damage', () => {
  test('a shortage noted at verification holds the payment; resolving it for more than the payment carries the excess forward', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await setRole(page, 'ADMIN');
    await verifyWithFinding(page, 'shortage', 'Eleven bundles short at the unloading gate', '90000');

    // It is on the SDR list without anyone entering it there.
    await openNav(page, /^Supply/, /^SDR/, /\/sdr$/);
    await expect(page.getByRole('button', { name: 'Record shortage or damage' })).toHaveCount(0);
    await expect(row(page, '120869')).toContainText('Eleven bundles short at the unloading gate');
    await expect(row(page, '120869')).toContainText('Payment on hold');
    await expect(page.getByTestId('sdr-snd')).toContainText('1');

    // The trip's payment is held while it is open.
    await openNav(page, /^Payments/, /^Final payments/, /\/payments\/balance$/);
    await expect(page).toHaveURL(/\/payments\/balance$/);
    await row(page, '120869').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText('1 shortage or damage record is still open')).toBeVisible();

    // Resolve it for more than the payment: the whole payment is taken, and the rest carries.
    await openNav(page, /^Supply/, /^SDR/, /\/sdr$/);
    await expect(page).toHaveURL(/\/sdr$/);
    await row(page, '120869').getByRole('button', { name: 'Resolve' }).click();
    const form = dialog(page, /^Resolve SDR-/);
    await expect(fieldControl(form, 'Amount to deduct')).toHaveValue('90000');
    await form.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText(/resolved — ₹90,000 comes off the payment/)).toBeVisible();

    await page.getByRole('tab', { name: /Recovery Pending/ }).click();
    await expect(row(page, '120869')).toContainText('₹90,000');

    // The payment now goes out after the deduction, and what it cannot cover carries.
    await openNav(page, /^Payments/, /^Final payments/, /\/payments\/balance$/);
    await row(page, '120869').getByRole('button', { name: 'Open' }).click();
    await expect(page.getByText(/Less shortage \/ damage SDR-/)).toBeVisible();
    await expect(page.getByText(/is more than this payment — it carries to their next orders/)).toBeVisible();

    // What is left to recover is the transporter's negative balance; Compliance can
    // write it off, but only on Leadership's mail, which is recorded with the waiver.
    await openNav(page, /^Supply/, /^SDR/, /\/sdr$/);
    await page.getByRole('tab', { name: /Recovery Pending/ }).click();
    await expect(row(page, '120869')).toContainText('still to recover');
    await row(page, '120869').getByRole('button', { name: 'Waive balance' }).click();
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
    await verifyWithFinding(page, 'damage', 'Two cartons crushed in transit');

    await openNav(page, /^Supply/, /^SDR/, /\/sdr$/);
    await row(page, '120869').getByRole('button', { name: 'Resolve' }).click();
    const form = dialog(page, /^Resolve SDR-/);
    await fieldControl(form, 'Amount to deduct').fill('4000');
    await form.getByRole('button', { name: 'Resolve' }).click();
    await expect(page.getByText(/resolved — ₹4,000 comes off the payment/)).toBeVisible();

    await openNav(page, /^Payments/, /^Final payments/, /\/payments\/balance$/);
    await expect(row(page, '120869').locator('td[data-label="Shortage / damage"]')).toHaveText('₹4,000');
  });

  test('nobody is offered a way to record one by hand, not even an administrator', async ({ page }) => {
    await setRole(page, 'ADMIN');
    await page.goto('/sdr');
    await expect(page.getByRole('heading', { name: 'SDR' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record shortage or damage' })).toHaveCount(0);
  });

  test('Finance can see the records but not record or resolve one', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/sdr');
    await expect(page.getByRole('heading', { name: 'SDR' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record shortage or damage' })).toHaveCount(0);
  });
});
