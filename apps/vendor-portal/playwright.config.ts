import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config — runs against src/lib/mock.ts fixtures (NEXT_PUBLIC_MOCK=1),
 * the same data FE.md documents as the wire contract. No vendor-api/
 * internal-api dependency.
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
    baseURL: 'http://localhost:3001',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
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
    command: 'pnpm dev',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { NEXT_PUBLIC_MOCK: '1' },
  },
});
