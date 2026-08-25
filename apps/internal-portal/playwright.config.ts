import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config — runs against the mock adapter (NEXT_PUBLIC_USE_MOCKS=1), the
 * same fixture data every page already renders against in local dev. No
 * internal-api dependency; tests exercise the console the way FE.md's
 * contract describes it, not the live backend (which doesn't exist yet).
 */
export default defineConfig({
  testDir: './e2e',
  // Compiles every route once, up front, so no test pays for a cold `next dev`
  // build mid-navigation. See the file for why that mattered.
  globalSetup: './e2e/warm-routes.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['html', { open: 'never' }]],
  timeout: 30_000,
  /**
   * Three times Playwright's 5s default, because these specs run against
   * `next dev`, which compiles a route the first time anything asks for it.
   * The app-router holds the URL while that compile finishes, so the very
   * first `toHaveURL` for a route is waiting on a webpack build, not on a
   * render — routinely several seconds on a cold `.next`, and longer when
   * workers compile different routes at once.
   *
   * The symptom this removes is specific and costly: a navigation assertion
   * that passes alone and fails in a full run. That reads as flake, gets
   * retried or deleted, and takes a real regression with it the day one
   * happens. The trade is that a genuinely failing assertion now takes 15s
   * to report instead of 5s.
   */
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:3002',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Chromium with a phone viewport, not the iPhone device preset — this
    // suite tests our own responsive CSS/JS, not WebKit compatibility, so a
    // second rendering engine isn't worth the extra browser install.
    {
      name: 'mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { NEXT_PUBLIC_USE_MOCKS: '1' },
  },
});
