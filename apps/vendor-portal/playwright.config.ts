import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config — runs against src/lib/mock.ts fixtures (NEXT_PUBLIC_MOCK=1),
 * the same data FE.md documents as the wire contract. No vendor-api/
 * internal-api dependency.
 */
/**
 * The port is overridable so a local run does not have to share one with
 * whatever is already listening on 3001.
 *
 * `reuseExistingServer` is on outside CI, which is the right default — but it
 * means a plain `npx playwright test` attaches to any dev server already on
 * 3001 and drives it. When that server is also serving something else, the
 * suite recompiles under it and the failures come back as `ERR_CONNECTION_RESET`
 * and `page.goto` timeouts: navigation errors, not assertions, and worthless
 * either way. `E2E_PORT=3021 npx playwright test` gets a private one.
 */
const PORT = Number(process.env.E2E_PORT ?? 3001);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Writes a fixture session, then compiles every route once up front so no
  // test pays for a cold `next dev` build mid-navigation. Both live behind one
  // entry point because Playwright takes a single `globalSetup`.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['html', { open: 'never' }]],
  timeout: 30_000,
  /**
   * Three times Playwright's 5s default. These specs run against `next dev`,
   * and the app-router holds the URL while a route compiles, so the first
   * assertion for a route waits on a webpack build rather than a render.
   * Warming above removes most of that; this covers the tail.
   */
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    /*
     * Every spec starts signed in. The app now redirects a tokenless visitor
     * to `/signin`, and each spec navigates straight to a private route — so
     * without this, all of them would assert against the sign-in form.
     * Written by `global-setup.ts`; a fixture token, never a real credential.
     *
     * A spec that means to test signing in must clear storage itself, or it
     * arrives already signed in and gets redirected off the form.
     */
    storageState: './e2e/.auth/state.json',
  },
  // Chromium with a phone viewport, not the iPhone device preset — this
  // suite tests our own phone-first CSS/JS, not WebKit compatibility, so a
  // second rendering engine isn't worth the extra browser install.
  projects: [
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: `pnpm dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { NEXT_PUBLIC_MOCK: '1', PORT: String(PORT) },
  },
});
