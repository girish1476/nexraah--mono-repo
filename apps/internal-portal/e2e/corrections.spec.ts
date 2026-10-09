import { Locator, Page, test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Putting a mistake right, from the screens people use (8 Oct 2026):
 *
 *   a load request   edit its details, at any stage
 *   a quote          edit its amount, or remove it
 *   an agreed rate   edit it in place, with a reason
 *   a proposed rate  edit it while it waits; and once turned down, correct it
 *                    and send it again
 *
 * One role (ADMIN) and no reloads: the seeded fixture lives in the page, so a
 * hard navigation would undo the records this test creates.
 */

const field = (scope: Page | Locator, label: string) =>
  scope.locator('div.field').filter({ hasText: label }).locator('input, select, textarea').first();
const dialog = (page: Page, title: string | RegExp) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: title }) }).last();
const panel = (page: Page, title: string | RegExp) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: title }) }).first();

test.use({ actionTimeout: 20_000 });

test('a load request and its quote are corrected where they stand', async ({ page }) => {
  await setRole(page, 'ADMIN');
  await page.goto('/indents/i-4462');

  // The load request: the weight was typed wrongly.
  await panel(page, 'Indent').getByRole('button', { name: /Edit/ }).click();
  const load = dialog(page, 'Edit the load request');
  await expect(load.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await field(load, 'Weight (MT)').fill('21.5');
  await field(load, 'Why it is being corrected').fill('Weight was typed from the wrong mail');
  await load.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Load request corrected')).toBeVisible();
  await expect(page.locator('main')).toContainText('21.5');

  // A quote entered with one zero too many.
  await page.getByRole('button', { name: 'Enter a quote' }).click();
  const q = dialog(page, 'Enter a quote');
  await field(q, 'Transporter').selectOption({ index: 1 });
  await field(q, 'Quote (₹)').fill('440000');
  await q.getByRole('button', { name: 'Enter quote' }).click();
  await expect(page.getByText('Quote entered')).toBeVisible();
  const row = page.locator('table.table tbody tr').filter({ hasText: '₹4,40,000' });
  await expect(row).toHaveCount(1);

  await row.getByRole('button', { name: /Edit/ }).click();
  const fix = dialog(page, 'Edit the quote');
  await field(fix, 'Correct amount (₹)').fill('44000');
  await field(fix, 'Why it is being corrected').fill('One zero too many');
  await fix.getByRole('button', { name: 'Save the amount' }).click();
  await expect(page.getByText('Quote corrected to ₹44,000')).toBeVisible();
  const fixed = page.locator('table.table tbody tr').filter({ hasText: '₹44,000' });
  await expect(fixed).toHaveCount(1);
  await expect(page.locator('table.table tbody tr').filter({ hasText: '₹4,40,000' })).toHaveCount(0);

  // Entered on the wrong load altogether: removed.
  await fixed.getByRole('button', { name: /Remove/ }).click();
  const gone = dialog(page, 'Remove this quote');
  await field(gone, 'Why it is being removed').fill('Entered on the wrong load');
  await gone.getByRole('button', { name: 'Remove the quote' }).click();
  await expect(page.getByText(/Quote from .* removed/)).toBeVisible();
  await expect(page.locator('table.table tbody tr').filter({ hasText: '₹44,000' })).toHaveCount(0);
});

test('a rate is corrected in place, and one turned down is corrected and sent again', async ({ page }) => {
  await setRole(page, 'ADMIN');
  await page.goto('/clients/c-0092');

  // An agreed rate typed ₹100 short.
  const card = panel(page, 'Rate card');
  await card.getByRole('button', { name: /Edit/ }).first().click();
  const agreed = dialog(page, 'Edit the agreed rate');
  await field(agreed, 'Lane rate (₹)').fill('64300');
  await expect(agreed.getByRole('button', { name: 'Save the rate' })).toBeDisabled();
  await field(agreed, 'Why it is being corrected').fill('Typed ₹100 short of the agreement');
  await agreed.getByRole('button', { name: 'Save the rate' }).click();
  await expect(page.getByText(/Rate corrected/)).toBeVisible();
  await expect(card).toContainText('₹64,300');

  // A new lane, proposed with a rate ten times too high.
  await page.getByRole('link', { name: /Add a lane/ }).first().click();
  const lane = dialog(page, /^Add a lane/);
  await lane.getByPlaceholder('e.g. 32 ft MXL').fill('32 ft MXL');
  await field(lane, 'Transit days').fill('2');
  await lane.locator('div.field').filter({ hasText: 'From location' }).locator('input').fill('Salem');
  await lane.locator('div.field').filter({ hasText: 'To location' }).locator('input').fill('Erode');
  await field(lane, 'Lane rate per truck (₹)').fill('990000');
  await field(lane, 'Approval mail subject').fill('RE: Salem–Erode rate approved');
  await lane.locator('div.field').filter({ hasText: 'Where this rate was agreed' }).locator('textarea').fill('Agreed with the client by mail on 6 October 2026.');
  await lane.getByRole('button', { name: 'Send for sign-off' }).click();
  await expect(page.getByText(/Sent for sign-off/)).toBeVisible();

  // The approver turns it down, saying why.
  const menu = page.getByRole('button', { name: 'Open menu' });
  if (await menu.isVisible()) {
    await page.getByRole('link', { name: /approvals waiting for you/ }).click();
  } else {
    const control = page.getByRole('navigation').getByRole('button', { name: /^Control/ });
    if ((await control.getAttribute('aria-expanded')) !== 'true') await control.click();
    await page.getByRole('navigation').getByRole('link', { name: /^Approvals/ }).click();
  }
  await expect(page).toHaveURL(/\/admin\/approvals/);
  const request = page.locator('.surface').filter({ hasText: 'Salem → Erode' }).last();
  await request.getByRole('button', { name: 'Reject' }).click();
  const no = dialog(page, 'Reject this request');
  await no.locator('textarea, input').first().fill('Rate is ten times too high');
  await no.getByRole('button', { name: /^Reject/ }).last().click();
  await expect(page.getByText(/Rejected/).first()).toBeVisible();

  // Back on the client: it is kept, with the reason, to correct and send again.
  await page.goBack();
  await page.goBack();
  await expect(page).toHaveURL(/\/clients\/c-0092$/);
  const turnedDown = panel(page, /Rates that were turned down/);
  await expect(turnedDown).toContainText('Turned down: Rate is ten times too high');
  await turnedDown.getByRole('button', { name: /Edit and send again/ }).click();
  const again = dialog(page, /^Add a lane/);
  await expect(again.locator('div.field').filter({ hasText: 'From location' }).locator('input')).toHaveValue('Salem');
  await expect(field(again, 'Approval mail subject')).toHaveValue('RE: Salem–Erode rate approved');
  await field(again, 'Lane rate per truck (₹)').fill('99000');
  await again.getByRole('button', { name: 'Send for sign-off' }).click();
  await expect(page.getByText(/Sent for sign-off/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Rates that were turned down/ })).toHaveCount(0);

  // Still waiting — and still editable where it waits.
  const waiting = panel(page, /Lanes waiting for approval/);
  await expect(waiting).toContainText('₹99,000');
  await waiting.getByRole('button', { name: /Edit/ }).first().click();
  const proposed = dialog(page, 'Edit the proposed rate');
  await field(proposed, 'Lane rate (₹)').fill('98000');
  await proposed.getByRole('button', { name: 'Save the rate' }).click();
  await expect(page.getByText(/Proposal corrected/)).toBeVisible();
  await expect(waiting).toContainText('₹98,000');
});
