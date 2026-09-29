import { test, expect, Page } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The Payments tab of `/orders/[id]` — order-level accounting.
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

async function openPayments(page: Page) {
  await page.goto('/orders/i-4421');
  await page.getByRole('tab', { name: /Payments/ }).click();
  await expect(page.getByText('Money paid out')).toBeVisible();
}

test.describe('Order payments tab', () => {
  test('is offered alongside the other tabs', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/orders/i-4421');
    await expect(page.getByRole('tab', { name: /Payments/ })).toBeVisible();
  });

  test('lists the advance with its UTR, the charges, and the unpaid balance', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await openPayments(page);

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

  test('shows the sourcing rate, the placement rate and the margin to Finance', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await openPayments(page);

    await expect(page.getByText('Sourcing rate (vehicle placed at)')).toBeVisible();
    await expect(page.getByText('₹29,400', { exact: true })).toBeVisible();
    await expect(page.getByText('Placement rate (client accepted)')).toBeVisible();
    await expect(page.getByText('₹34,800', { exact: true })).toBeVisible();
    await expect(page.getByText('Profit margin', { exact: true })).toBeVisible();
    await expect(page.getByText('₹4,000 · 11.5%')).toBeVisible();
  });

  test('hides the margin, but not the rates, from a desk with no P&L access', async ({ page }) => {
    await setRole(page, 'COMPLIANCE');
    await openPayments(page);

    await expect(page.getByText('Sourcing rate (vehicle placed at)')).toBeVisible();
    await expect(page.getByText('Placement rate (client accepted)')).toBeVisible();
    await expect(page.getByText('Profit margin', { exact: true })).toHaveCount(0);
    await expect(page.getByText('HDFCN00120855')).toBeVisible();
  });
});
