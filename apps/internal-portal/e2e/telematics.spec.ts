import { test, expect, Locator, Page } from '@playwright/test';
import { setRole } from './helpers';

/**
 * Fleet board — `/telematics`. No test file existed for this module before
 * this one.
 *
 * The "Update truck" dialog's own body copy ("Ops updates a truck's position
 * and status by hand") promised a location field that never existed — only
 * speed, fuel, the e-way date and status alerts were wired up, even though
 * the server (`ManualUpdateDto`) always accepted `lat`/`lng` and the trip
 * detail page's "Position" tile always displayed them. This pins the fix
 * end to end: a location entered on the fleet board has to actually reach
 * the trip page that reads it back.
 */

// `Field` (lib/ui.tsx) renders its <label> with no `htmlFor`, so nothing
// ties it to the input for `getByLabel` — same workaround already used in
// invoicing.spec.ts and signin.spec.ts for the same component. `hasText`
// rather than a nested `has: getByText(...)` — simpler, and the label text
// here is unique enough per field that a substring match can't cross over.
const fieldControl = (scope: Page | Locator, label: string): Locator =>
  scope
    .locator('div.field')
    .filter({ hasText: label })
    .locator('input, select, textarea')
    .first();

test.describe('fleet board — manual update', () => {
  test('updating a vehicle\'s coordinates changes the linked trip\'s Position tile', async ({ page }) => {
    await setRole(page, 'OPS');
    await page.goto('/telematics');

    const row = page.locator('table.table tbody tr').filter({ hasText: 'MH 15 GT 4482' });
    await row.getByRole('button', { name: 'Update' }).click();

    const dialog = page.locator('.surface').filter({ has: page.getByRole('heading', { name: 'Update MH 15 GT 4482' }) });
    await expect(dialog).toBeVisible();

    // Seeded at 22.5726, 88.3639 (Kolkata) — move it to a different, clearly
    // distinct point so the assertion can't pass by coincidence.
    const lat = fieldControl(dialog, 'Latitude');
    const lng = fieldControl(dialog, 'Longitude');
    await expect(lat).toHaveValue('22.5726');
    await expect(lng).toHaveValue('88.3639');
    await lat.fill('19.076');
    await lng.fill('72.8777');

    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    // Re-open the same dialog: the new values round-tripped through the
    // save, not just held in the form's own local state.
    await row.getByRole('button', { name: 'Update' }).click();
    await expect(fieldControl(page, 'Latitude')).toHaveValue('19.076');
    await expect(fieldControl(page, 'Longitude')).toHaveValue('72.8777');
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { name: 'Update MH 15 GT 4482' })).toBeHidden();

    // The linked trip (TRP-120881) reads its Position tile from the same
    // vehicle row — this is the whole point of the fix. Reached by clicking
    // through, not `page.goto`: a hard navigation reloads every JS module,
    // which resets the mock adapter's in-memory `db` back to its seed data
    // (see the same note on `lib/auth.ts`'s sign-in flow) — that would
    // silently undo the very save this test exists to check.
    //
    // Via Orders rather than Global search: search has no sidebar row to
    // click at the moment (mid-flight elsewhere in this tree), so `/orders`
    // — client-side `router.push` on a row click, not a link, but still no
    // reload — is the reachable path. Searched by trip number, which the
    // orders list itself supports (`Client, lane, order or trip number…`).
    const orders = page.getByRole('button', { name: /^Orders/ });
    await orders.click();
    await page.getByRole('link', { name: /^All orders/ }).click();
    await expect(page).toHaveURL(/\/orders$/);
    // The row shows the order and indent code, not the trip code, so the
    // search narrowing the table to one match is what's being relied on
    // here, not filtering rows by visible text afterward.
    await page.getByPlaceholder(/Client, lane, order or trip number/).fill('TRP-120881');
    const orderRows = page.locator('table.table tbody tr');
    await expect(orderRows).toHaveCount(1);
    await orderRows.first().click();
    await page.getByRole('link', { name: 'Trip' }).click();
    await expect(page.getByRole('heading', { name: 'TRP-120881' })).toBeVisible();

    const positionTile = page.locator('.stat-strip > div').filter({ has: page.getByText('Position', { exact: true }) });
    await expect(positionTile).toContainText('19.0760, 72.8777');
  });
});
