import { defineConfig, devices } from '@playwright/test';

/**
 * Runs the existing e2e specs against the hosted Vercel deployment instead
 * of a local dev server — a real "does the public demo work" check.
 *
 *   npx playwright test --config playwright.vercel.config.ts e2e/signin.spec.ts
 *
 * Override the target with E2E_BASE_URL. No webServer block on purpose.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://nexraah-mono-repo.vercel.app',
    trace: 'off',
    ...devices['Desktop Chrome'],
  },
});
