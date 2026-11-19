import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';
import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Real emailed sign-in codes, end to end (e2e/real-email.spec.ts):
 *
 *   npx next build && npx playwright test -c playwright.real-email.config.ts
 *
 * Starts the built console with email sign-in switched on and made-up
 * settings. EMAIL_TEST_OUTBOX makes the mailer write each email to a file
 * instead of sending it, so nothing leaves the machine and no key is needed.
 * One worker: both browsers sign in as the same person, and each reads the
 * newest code in the shared file.
 */
const PORT = Number(process.env.E2E_PORT ?? 3013);
const OUTBOX = join(tmpdir(), `nexraah-outbox-${PORT}.jsonl`);
rmSync(OUTBOX, { force: true });
process.env.EMAIL_TEST_OUTBOX = OUTBOX;

export default defineConfig({
  ...base,
  testMatch: /real-email\.spec\.ts/,
  workers: 1,
  use: { ...base.use, baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      SIGNIN_SECRET: `e2e-only-${Math.random().toString(36).slice(2)}-secret`,
      SIGNIN_PEOPLE: 'kavya@test.in=ADMIN=Kavya S',
      EMAIL_FROM: 'Nexraah <no-reply@test.in>',
      BREVO_API_KEY: 'unused-the-outbox-catches-every-email',
      EMAIL_TEST_OUTBOX: OUTBOX,
      // The list of people comes from SIGNIN_PEOPLE alone, not a shared database.
      KV_REST_API_URL: '',
      UPSTASH_REDIS_REST_URL: '',
    },
  },
});
