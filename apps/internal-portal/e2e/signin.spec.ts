import { test, expect, type Page } from '@playwright/test';

/**
 * The sign-in gate.
 *
 * Every other spec in this suite starts already signed in, via `setRole`'s
 * seeded token — which means nothing else here exercises the door itself.
 * That gap is how six checked-in JWTs managed to expire without a single
 * test going red: the suite injected them and never once asked whether a
 * person could actually get in.
 *
 * These run against mocks (see playwright.config.ts), so `/signin` is
 * checking passwords against the fixture accounts in `src/mocks/db.ts`. With
 * `NEXT_PUBLIC_USE_MOCKS=0` the same form posts to Supabase Auth instead;
 * only the transport differs, and what is asserted below sits above it.
 */

const DEMO_PASSWORD = 'nexraah';
const OPS_EMAIL = 'anil@nexraah.in';

/**
 * Longer than the 5s default, because what these assertions wait on is not a
 * render — it is a redirect that only settles after a whole session
 * round-trip: sign-in, then `SessionBootstrap`'s `GET /auth/session`, then a
 * client-side route change decided by the role that call returned.
 *
 * Almost every other spec here seeds a token and loads one page. These drive
 * three page transitions each, so they cost roughly three times as much and
 * are the first thing to time out when six workers share one dev server.
 * Measured at ~20s for a single test against a cold server, so 5s (and then
 * 15s) had them passing alone and failing in a full run — the classic shape
 * of a test that gets marked flaky and then ignored.
 */
const NAV_TIMEOUT = 30_000;

// Triples the per-test budget, for the same reason.
test.beforeEach(() => test.slow());

/**
 * Every test here drives the form rather than seeding a token with
 * `setRole`. That helper injects through `addInitScript`, which re-runs on
 * *every* navigation — so a test that signs out and then navigates gets the
 * token put straight back, and would pass whether the sign-out worked or not.
 */
async function signIn(page: Page, email = OPS_EMAIL, password = DEMO_PASSWORD) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/**
 * Scoped to the form: Next.js gives its own route announcer `role="alert"`,
 * so an unscoped `getByRole('alert')` matches two elements and resolves to
 * the empty one.
 */
const formAlert = (page: Page) => page.locator('form').getByRole('alert');

/**
 * Sign out is in the sidebar, which is off-canvas below the 900px breakpoint
 * — so on the `mobile` project the drawer has to be opened to reach it.
 * Checking for the hamburger rather than branching on the project name keeps
 * this working whatever viewport a project is configured with.
 */
async function signOutFromShell(page: Page) {
  const hamburger = page.getByRole('button', { name: 'Open menu' });
  if (await hamburger.isVisible()) await hamburger.click();
  await page.getByRole('button', { name: 'Sign out' }).click();
}

test.describe('signing in', () => {
  test('an unauthenticated visitor is sent to the sign-in screen', async ({ page }) => {
    await page.goto('/today');
    await expect(page).toHaveURL(/\/signin$/, { timeout: NAV_TIMEOUT });
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('a correct password lands on the role’s own screen', async ({ page }) => {
    await signIn(page);

    // OPS lands on /today — the redirect is SessionBootstrap's, driven by the
    // role in the session the server returned, not by anything this form knew.
    await expect(page).toHaveURL(/\/today/, { timeout: NAV_TIMEOUT });
    await expect(page.getByText('Anil Deshmukh')).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('a wrong password says so and does not sign anyone in', async ({ page }) => {
    await signIn(page, OPS_EMAIL, 'wrong-password');

    await expect(formAlert(page)).toContainText(/do not match an account/i, { timeout: NAV_TIMEOUT });
    await expect(page).toHaveURL(/\/signin$/, { timeout: NAV_TIMEOUT });
    expect(await page.evaluate(() => window.localStorage.getItem('token'))).toBeNull();
  });

  test('an unknown email fails the same way a wrong password does', async ({ page }) => {
    // Identical wording is the point: a distinguishable failure would let
    // someone enumerate who has an account here.
    await signIn(page, 'nobody@nexraah.in');

    await expect(formAlert(page)).toContainText(/do not match an account/i, { timeout: NAV_TIMEOUT });
  });

  test('a demo account fills the form but still has to sign in', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('button', { name: /Sunita Rao/ }).click();

    await expect(page.getByLabel('Email')).toHaveValue('sunita@nexraah.in', { timeout: NAV_TIMEOUT });
    // Still on the sign-in screen — picking a seat is not signing in, which
    // is exactly what the one-click role buttons this replaces got wrong.
    await expect(page).toHaveURL(/\/signin$/, { timeout: NAV_TIMEOUT });

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(/\/today/, { timeout: NAV_TIMEOUT });
    await expect(page.getByText('Nashik branch')).toBeVisible({ timeout: NAV_TIMEOUT });
  });

  test('signing in stores a refresh token and an expiry, not just an access token', async ({
    page,
  }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/today/, { timeout: NAV_TIMEOUT });

    const stored = await page.evaluate(() => ({
      token: window.localStorage.getItem('token'),
      refresh: window.localStorage.getItem('refreshToken'),
      expiresAt: Number(window.localStorage.getItem('tokenExpiresAt')),
    }));

    expect(stored.token).toBeTruthy();
    expect(stored.refresh).toBeTruthy();
    expect(stored.expiresAt).toBeGreaterThan(Date.now());
  });
});

test.describe('signing out', () => {
  test('clears the session and returns to the sign-in screen', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/today/, { timeout: NAV_TIMEOUT });

    await signOutFromShell(page);

    await expect(page).toHaveURL(/\/signin$/, { timeout: NAV_TIMEOUT });
    expect(await page.evaluate(() => window.localStorage.getItem('token'))).toBeNull();
    expect(await page.evaluate(() => window.localStorage.getItem('refreshToken'))).toBeNull();
  });

  test('a signed-out visitor cannot walk back into a screen', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/today/, { timeout: NAV_TIMEOUT });
    await signOutFromShell(page);
    await expect(page).toHaveURL(/\/signin$/, { timeout: NAV_TIMEOUT });

    await page.goto('/payments/balance');
    await expect(page).toHaveURL(/\/signin$/, { timeout: NAV_TIMEOUT });
  });
});

test.describe('an expired session', () => {
  test('is refreshed in place rather than shown as a failure', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/today/, { timeout: NAV_TIMEOUT });

    const original = await page.evaluate(() => window.localStorage.getItem('token'));

    // Backdate the expiry into the refresh margin, the way a tab left open
    // overnight arrives the next morning. The refresh token is untouched, so
    // this is recoverable without anyone retyping a password.
    await page.evaluate(() => window.localStorage.setItem('tokenExpiresAt', String(Date.now() + 5_000)));
    await page.goto('/home');

    await expect(page).toHaveURL(/\/home/, { timeout: NAV_TIMEOUT });
    expect(await page.evaluate(() => window.localStorage.getItem('token'))).not.toBe(original);
  });

  test('with nothing left to refresh with, ends at the sign-in screen', async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/today/, { timeout: NAV_TIMEOUT });

    // A token past its `exp` and no refresh token left to spend: the mock
    // adapter 401s, `apis.ts` has nothing to retry with, and the session is
    // genuinely over rather than merely stale.
    await page.evaluate(() => {
      const [header, payload, sig] = window.localStorage.getItem('token')!.split('.');
      const claims = JSON.parse(atob(payload));
      claims.exp = Date.now() - 1000;
      window.localStorage.setItem('token', [header, btoa(JSON.stringify(claims)), sig].join('.'));
      window.localStorage.removeItem('refreshToken');
    });
    await page.goto('/home');

    await expect(page).toHaveURL(/\/signin$/, { timeout: NAV_TIMEOUT });
  });
});
