import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { FullConfig } from '@playwright/test';
import warmRoutes from './warm-routes';

/**
 * Signs the suite in, then warms the routes.
 *
 * This app gained a front door: `providers.tsx` sends anyone without a token to
 * `/signin`, and `apis.ts` sends a 401 there too. Every spec here navigates
 * straight to a private route, so without a stored session all of them would
 * land on the sign-in screen and fail on an assertion about loads or trips —
 * dozens of red tests describing one missing token.
 *
 * The session is written as a Playwright `storageState` file rather than an
 * `addInitScript` in each spec: it needs no spec to change, it survives a new
 * spec being added, and a contributor who has not read this file still gets a
 * signed-in page. `playwright.config.ts` points `use.storageState` at it.
 *
 * The token is deliberately a **fixture** token in the shape `lib/auth.ts`
 * mints under `NEXT_PUBLIC_MOCK=1`. It is not a credential: the fixture adapter
 * never inspects it and a real `vendor-api` would reject it outright. That is
 * the point — this file can never accidentally hold something real.
 *
 * What this does NOT cover, on purpose: the sign-in screen itself. A spec that
 * tests signing in must clear storage first (`page.context().clearCookies()`
 * plus `localStorage.clear()`), or it arrives already signed in and is
 * redirected away from the form it meant to test.
 */

export const STATE_PATH = join(__dirname, '.auth', 'state.json');

/** An hour ahead, so `ensureFreshToken()` leaves it alone mid-run. */
function fixtureSession() {
  const expiresAt = Date.now() + 3600_000;
  return [
    { name: 'token', value: `mock.9876543210.${Date.now()}` },
    { name: 'refreshToken', value: 'mock-refresh.9876543210' },
    { name: 'tokenExpiresAt', value: String(expiresAt) },
  ];
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const base =
    (config.projects[0]?.use?.baseURL as string | undefined) ?? 'http://localhost:3001';

  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(
    STATE_PATH,
    JSON.stringify(
      { cookies: [], origins: [{ origin: base, localStorage: fixtureSession() }] },
      null,
      2,
    ),
    'utf8',
  );

  await warmRoutes(config);
}
