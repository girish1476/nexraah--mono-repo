import { test, expect, Page } from '@playwright/test';

/**
 * The header account menu — reaching your own file from anywhere.
 *
 * This exists because the thing it tests silently stopped working. `NFR-06`
 * asks for "four bottom tabs, profile in the header menu"; the menu was a bare
 * link placed by each screen through `ScreenHeader`'s `right` slot, so on
 * Loads — where everyone lands — the truck-type filter took the slot and the
 * link was simply never rendered. Two of the four tabs had it. Nothing failed.
 *
 * So the assertion that matters is not "the button looks right", it is
 * **"Profile is reachable from every tab"** — the property that regressed.
 */

const TABS = ['/loads', '/quotes', '/trips', '/fleet'] as const;

function accountButton(page: Page) {
  return page.getByRole('button', { name: /Account and profile/ });
}

test.describe('reaching Profile', () => {
  for (const tab of TABS) {
    test(`the account button is on ${tab}`, async ({ page }) => {
      await page.goto(tab);
      await expect(accountButton(page)).toBeVisible();
    });
  }

  test('every sub-page carries it too, not just the tabs', async ({ page }) => {
    // A transporter deep in a trip should not have to tab back out to find
    // out why their advance is held.
    for (const url of ['/loads/LD-4471', '/trips/TR-20881', '/trips/TR-20881/pod']) {
      await page.goto(url);
      await expect(accountButton(page), `no account button on ${url}`).toBeVisible();
    }
  });

  test('opening it and choosing Profile lands on the profile screen', async ({ page }) => {
    await page.goto('/loads');
    await accountButton(page).click();
    await page.getByRole('link', { name: 'Profile & documents' }).click();
    await expect(page).toHaveURL(/\/profile$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
  });
});

test.describe('what the sheet says', () => {
  test('names who is signed in — a shared phone may not be yours', async ({ page }) => {
    await page.goto('/loads');
    await accountButton(page).click();

    const sheet = page.getByRole('dialog', { name: 'Account' });
    await expect(sheet).toContainText('Rathod Roadlines');
    await expect(sheet).toContainText('Sandeep Rathod · transporter V-2214');
  });

  test('offers Sign out', async ({ page }) => {
    // `signOut()` existed in lib/auth.ts with no caller anywhere in the app,
    // so a driver on a shared phone could not end their session.
    await page.goto('/loads');
    await accountButton(page).click();
    await expect(
      page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Sign out' }),
    ).toBeVisible();
  });

  test('closes on Escape and on a tap outside', async ({ page }) => {
    await page.goto('/loads');
    const sheet = page.getByRole('dialog', { name: 'Account' });

    await accountButton(page).click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await accountButton(page).click();
    await expect(sheet).toBeVisible();
    await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
  });
});

test.describe('the attention badge', () => {
  /*
   * The fixture has four papers needing the transporter: a rejected address
   * proof, an expired fitness certificate grounding MH 12 RB 7721, and two
   * never uploaded. Before this, none of that was visible anywhere except by
   * opening Profile and scrolling — so the way most transporters found out was
   * that their advance did not arrive.
   */
  test('shows the count on a tab screen, not only on Profile', async ({ page }) => {
    await page.goto('/loads');
    await expect(accountButton(page)).toContainText('4');
  });

  test('leads with the grounded truck rather than the paper count', async ({ page }) => {
    await page.goto('/loads');
    await accountButton(page).click();
    // "1 truck is off the road" is acted on today; "4 papers" is scrolled past.
    await expect(page.getByRole('dialog', { name: 'Account' })).toContainText('MH 12 RB 7721');
  });

  test('the Profile screen agrees with the badge', async ({ page }) => {
    // Two places counting the same thing separately is how a badge ends up
    // saying 4 while the screen shows 3. Both read `lib/attention.ts`.
    await page.goto('/profile');
    const block = page.getByRole('region', { name: 'What needs you' });
    await expect(block).toContainText('MH 12 RB 7721');
    await expect(block).toContainText('Deal with these 4 and you are done.');
  });

  test('what needs doing sits above the full document list', async ({ page }) => {
    /*
     * The ordering is the fix. Twelve papers across three groups, most of them
     * fine — making somebody scroll all of it to discover one was rejected is
     * how a rejection sits unfixed for a fortnight.
     */
    await page.goto('/profile');
    const attention = await page
      .getByRole('region', { name: 'What needs you' })
      .boundingBox();
    const firstGroup = await page
      .locator('.card-title', { hasText: 'Identity — verified once, not per load' })
      .boundingBox();

    expect(attention).not.toBeNull();
    expect(firstGroup).not.toBeNull();
    expect(attention!.y).toBeLessThan(firstGroup!.y);
  });

  test('names the rejected paper and gives the compliance reason', async ({ page }) => {
    await page.goto('/profile');
    const block = page.getByRole('region', { name: 'What needs you' });
    await expect(block).toContainText('Address proof');
    await expect(block).toContainText('Electricity bill is more than three months old.');
  });
});
