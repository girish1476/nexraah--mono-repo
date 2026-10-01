import { Locator, Page, test, expect } from '@playwright/test';
import { setRole } from './helpers';

/**
 * The stretch of the operations flow between a raised indent and a truck on
 * the trip: Operations enters a quotation on the indent's own page, accepts
 * it there, accepting the bid generates the trip, and the vehicle is then
 * allocated to that trip.
 *
 * Fixture: 4462 (Apex Ceramics, OPEN, no quotes, band ₹42,000 – ₹47,000)
 * and the ACTIVE vendor Bhagwati Logistics.
 */

// `hasText` rather than a nested `getByText` — the scope here is often a dialog
// locator, and a locator passed to `has` is resolved *inside* each field.
function fieldControl(scope: Page | Locator, label: string) {
  return scope.locator('div.field').filter({ hasText: label }).locator('input, select');
}

const dialog = (page: Page, title: string) =>
  page.locator('.surface').filter({ has: page.getByRole('heading', { name: title }) });

test.describe('operations: bid to vehicle', () => {
  test('a quote entered on the details page can be accepted, which generates the trip, then a vehicle is allocated', async ({
    page,
  }) => {
    // One long walk through the whole stretch, across several routes on a dev server.
    test.setTimeout(90_000);
    await setRole(page, 'OPS');
    await page.goto('/indents/i-4462');

    // A price below the lane's floor is no longer refused: it is entered and
    // flagged "Below band" — cheaper is more margin, and the desk judges it.
    await expect(page.getByText('No quotes yet')).toBeVisible();
    await page.getByRole('button', { name: 'Enter a quote' }).click();
    let form = dialog(page, 'Enter a quote');
    await fieldControl(form, 'Transporter').selectOption({ label: 'Bhagwati Logistics · Hosur' });
    await fieldControl(form, 'Quote (₹)').fill('40000');
    await fieldControl(form, 'Truck registration').fill('TN 01 AB 1234');
    await form.getByRole('button', { name: 'Enter quote' }).click();
    await expect(page.getByText('Quote entered')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Bhagwati Logistics' })).toBeVisible();
    await expect(page.getByText('Below band', { exact: true })).toBeVisible();
    // No trip and no vehicle allocation exist until a bid is accepted.
    await expect(page.getByRole('button', { name: 'Allocate vehicle' })).toHaveCount(0);

    // Accepting it is on this same page, and it generates the trip.
    await page.getByRole('button', { name: 'Award' }).click();
    await expect(page.getByText(/trip \S+ generated/)).toBeVisible();
    await expect(page.getByText('Trip generated', { exact: true })).toBeVisible();
    await expect(page.getByText('Vehicle allocated', { exact: true })).toBeVisible();

    // The vehicle is allocated afterwards, on that trip; the dialog is
    // pre-filled with the truck the transporter quoted with.
    await page.getByRole('button', { name: 'Allocate vehicle' }).click();
    form = dialog(page, 'Allocate vehicle');
    await expect(fieldControl(form, 'Vehicle number')).toHaveValue('TN 01 AB 1234');
    // Only the driver's mobile is needed; name and licence are optional.
    await expect(form.getByRole('button', { name: 'Allocate vehicle' })).toBeDisabled();
    await fieldControl(form, 'Driver mobile number').fill('9876543210');
    await form.getByRole('button', { name: 'Allocate vehicle' }).click();
    await expect(page.getByText('Vehicle allocated', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Change vehicle' })).toBeVisible();

    // "Open the trip" lands on this indent's own trip, with the vehicle on it.
    await page.getByRole('link', { name: 'Open the trip' }).click();
    await expect(page).toHaveURL(/\/trips\/t-/);
    await expect(page.getByText('TN 01 AB 1234').first()).toBeVisible();

    // One loading supervisor is assigned to the trip; loading is started and
    // finished by them, and the trip cannot be sent off before it is.
    await expect(page.getByText('not assigned')).toBeVisible();
    await page.getByRole('button', { name: 'Assign loading supervisor' }).click();
    form = dialog(page, 'Assign loading supervisor');
    await fieldControl(form, 'Supervisor').selectOption({ label: 'Ravi Kumar' });
    await form.getByRole('button', { name: 'Assign' }).click();
    await expect(page.getByText('Loading supervisor assigned')).toBeVisible();
    await expect(page.getByText('Ravi Kumar').first()).toBeVisible();
    await expect(page.getByText(/Mark the truck as reached the loading point and loaded before this trip can start/)).toBeVisible();

    await page.getByRole('button', { name: 'Start loading' }).click();
    await expect(page.getByText('Loading started', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Loading complete' }).click();
    await expect(page.getByText('Loading marked complete')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Loading complete' })).toHaveCount(0);

    // The loading slip is one of the documents Compliance verifies before the advance.
    await page.getByRole('link', { name: 'the document list' }).click();
    await expect(page).toHaveURL(/\/trips\/t-.*\/documents/);
    await expect(page.getByText('Loading slip', { exact: true })).toBeVisible();
    await expect(page.getByText('Weighment slip', { exact: true })).toBeVisible();
  });

  test('Finance cannot enter a quote', async ({ page }) => {
    await setRole(page, 'FINANCE');
    await page.goto('/indents/i-4462');
    await expect(page.getByRole('heading', { name: '4462' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Enter a quote' })).toHaveCount(0);
  });
});
