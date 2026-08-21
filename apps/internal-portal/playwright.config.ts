import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config — runs against the mock adapter (NEXT_PUBLIC_USE_MOCKS=1), the
 * same fixture data every page already renders against in local dev. No
 * internal-api dependency; tests exercise the console the way FE.md's
 * contract describes it, not the live backend (which doesn't exist yet).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['html', { open: 'never' }]],
  timeout: 30_000,
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
