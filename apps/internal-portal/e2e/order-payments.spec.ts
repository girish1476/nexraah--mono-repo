import { test, expect, Page } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The order page, `/orders/[id]`: payments on Details, the Invoice tab, the
 * comment button and the Next step panel.
 *
 * Fixture order 4421 (Apex Ceramics, Gandhidham), all static data in
 * src/mocks/db.ts, so every figure can be pinned exactly:
 *   sourcing rate   ₹29,400   (what the vehicle was placed at)
 *   placement rate  ₹34,800   (what the client accepted)
 *   advance paid    ₹11,760
 *   unloading       ₹1,400    (no loading charge captured)
 *   balance         not paid yet
 *   margin          34,800 − 29,400 − 1,400 = ₹4,000 · 11.5%
 *
 * Margin follows the Profit and loss rule for who may see it: everything for
 * FINANCE (`pnl.view_all`), nothing for COMPLIANCE, who hold neither P&L
 * permission. The rates and the money that moved are visible to every desk.
 *
 * Seeded trips have no ledger rows, so the UTR shown is the fixture's
 * stand-in reference (HDFCN + the trip number's digits).
 */

async function openOrder(page: Page) {
  await page.goto('/orders/i-4421');
  await expect(page.getByText('Payments made to the transporter')).toBeVisible();
}

test.describe('Order page', () => {
  test('has Details, Documents and Invoice tabs — no separate Payments, Delivery proof or Comments tab', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/orders/i-4421');
    for (const name of [/Details/, /Documents/, /Invoice/]) {
      await expect(page.getByRole('tab', { name })).toBeVisible();
    }
    for (const name of [/Payments/, /Delivery proof/, /Comments/]) {
      await expect(page.getByRole('tab', { name })).toHaveCount(0);
    }
  });

  test('Details lists the advance with its UTR, the charges, and the unpaid balance', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await openOrder(page);

    await expect(page.getByText('Advance to the transporter')).toBeVisible();
    // Scoped to the Amount cell: with the balance unpaid, the "paid so far"
    // line under the table quotes the same ₹11,760.
    const amounts = page.locator('td[data-label="Amount"]');
    await expect(amounts.filter({ hasText: '₹11,760' })).toHaveCount(1);
    await expect(page.getByText('HDFCN00120855')).toBeVisible();

    await expect(page.getByText('Unloading charges')).toBeVisible();
    await expect(amounts.filter({ hasText: '₹1,400' })).toHaveCount(1);
    await expect(page.getByText('Not recorded yet')).toBeVisible(); // loading

    await expect(page.getByText('Balance to the transporter')).toBeVisible();
    await expect(page.getByText('Not paid yet')).toBeVisible();
  });

  test('Details shows the sourcing rate, the placement rate and the margin to Finance', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await openOrder(page);

    await expect(page.getByText('Sourcing rate (vehicle placed at)')).toBeVisible();
    await expect(page.getByText('Placement rate (client accepted)')).toBeVisible();
    await expect(page.getByText('Profit margin', { exact: true })).toBeVisible();
    await expect(page.getByText('₹4,000 · 11.5%')).toBeVisible();
  });

  test('hides the margin, but not the rates, from a desk with no P&L access', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await openOrder(page);

    await expect(page.getByText('Sourcing rate (vehicle placed at)')).toBeVisible();
    await expect(page.getByText('Placement rate (client accepted)')).toBeVisible();
    await expect(page.getByText('Profit margin', { exact: true })).toHaveCount(0);
    await expect(page.getByText('HDFCN00120855')).toBeVisible();
  });

  test('Details carries the next step and the vehicle tracking panel', async ({ page }) => {
    await setRole(page, 'OPS');
    await openOrder(page);
    await expect(page.getByText(/👉 Next step/).first()).toBeVisible();
    await expect(page.getByText('📍 Vehicle tracking')).toBeVisible();
  });

  test('the Invoice tab shows the client side of the money', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/orders/i-4421');
    await page.getByRole('tab', { name: /Invoice/ }).click();
    await expect(page.getByRole('heading', { name: /🧾 (Client invoice|Invoice )/ })).toBeVisible();
  });

  test('a comment is added from the 💬 button and stays on the order', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/orders/i-4421');
    await page.getByRole('button', { name: /Comments/ }).click();
    await page.getByPlaceholder('Add a remark or detail…').fill('Driver called — arriving at the consignee by 6pm.');
    await page.getByRole('button', { name: 'Add comment' }).click();
    await expect(page.getByText('Driver called — arriving at the consignee by 6pm.')).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('button', { name: /Comments \(\d+\)/ })).toBeVisible();
  });
});
