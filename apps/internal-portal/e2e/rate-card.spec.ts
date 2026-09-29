import { test, expect, Page, Locator } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Adding a lane to a client's rate card outside an RFQ —
 * `/clients/rate-changes` ("Add a lane") and the client file's rate card.
 *
 * Fixture facts (`src/mocks/db.ts`): CLT-0101 Mahalaxmi Textiles is a CONTRACT
 * client with no rate card; CLT-0088 Sanghvi Metals is SPOT.
 *
 * Finance proposes (`rate.revise`); Compliance approves (`approve.contract`).
 * The approving half is tested against the fixture directly in
 * `src/mocks/rate-card-lane.test.ts`.
 *
 * Every run uses a route nobody has used before: the mock db has no reset
 * endpoint, and a lane added by an earlier run would otherwise be refused as a
 * duplicate on the next.
 */

const field = (page: Page, label: string): Locator =>
  page.locator('.field').filter({ has: page.getByText(label, { exact: true }) });

test.describe('Add a lane to a rate card', () => {
  test('Finance proposes a lane and it goes for sign-off without touching the rate card', async ({ page }) => {
    const stamp = Date.now().toString().slice(-6);
    const origin = `Origin${stamp}`;
    const destination = `Dest${stamp}`;

    await setRole(page, 'FINANCE');
    await page.goto('/clients/rate-changes?client=c-0101&add=1');

    await expect(page.getByText('Add a lane · Mahalaxmi Textiles')).toBeVisible();
    const send = page.getByRole('button', { name: 'Send for sign-off' });
    await expect(send).toBeDisabled();

    await field(page, 'Truck type').locator('input').fill('32 ft MXL');
    await field(page, 'From location').locator('input').fill(origin);
    await field(page, 'To location').locator('input').fill(destination);
    await field(page, 'Transit days').locator('input').fill('3');
    await field(page, 'Lane rate (₹)').locator('input').fill('45000');
    await field(page, 'Approval mail subject').locator('input').fill('RE: rate approval from BD and Leadership');
    await field(page, 'Where this rate was agreed')
      .locator('textarea')
      .fill('Annexure 2 of the signed agreement dated 1 September');

    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText('Sent for sign-off. The lane is added to the rate card once it is approved.')).toBeVisible();

    // A proposal changes nothing anybody is billed against: the lane is not on
    // the card until it is approved. (The approve-and-land step is covered in
    // `src/mocks/rate-card-lane.test.ts` — the fixture db lives inside one
    // browser page, so a second page playing Compliance could never see this one.)
    await expect(page.getByText('This client has no agreed rates yet')).toBeVisible();
    await expect(page.getByText(origin)).toHaveCount(0);
  });

  test('the same route cannot be added twice over the same dates', async ({ page }) => {
    // c-0090 Apex Ceramics already has Mundra → Jaipur, 40 ft trailer, in force.
    await setRole(page, 'FINANCE');
    await page.goto('/clients/rate-changes?client=c-0090&add=1');

    await field(page, 'Truck type').locator('input').fill('40 ft trailer');
    await field(page, 'From location').locator('input').fill('Mundra');
    await field(page, 'To location').locator('input').fill('Jaipur');
    await field(page, 'Transit days').locator('input').fill('2');
    await field(page, 'Lane rate (₹)').locator('input').fill('60000');
    await field(page, 'Approval mail subject').locator('input').fill('RE: rate approval from BD and Leadership');
    await field(page, 'Where this rate was agreed')
      .locator('textarea')
      .fill('Repeat of the lane already on the card, to prove it is refused');
    await page.getByRole('button', { name: 'Send for sign-off' }).click();

    await expect(page.getByText(/already has an agreed rate for that route/)).toBeVisible();
  });

  test('a spot client has no rate card to add to', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/rate-changes?client=c-0088');
    await expect(page.getByText(/priced load by load, so they have no rate card/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Add a lane/ })).toHaveCount(0);
  });

  test('a desk without rate.revise is not offered the button', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/clients/c-0092');
    await expect(page.getByRole('link', { name: /Add a lane/ })).toHaveCount(0);
  });

  test('the client’s rate card shows truck type, from, to, transit days and lane rate as columns', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/clients/c-0092');
    const headers = page.locator('main th');
    for (const label of ['Truck type', 'From location', 'To location', 'Transit days', 'Lane rate']) {
      await expect(headers.filter({ hasText: label })).toHaveCount(1);
    }
    await expect(page.getByRole('link', { name: /Add a lane/ })).toBeVisible();
  });
});
