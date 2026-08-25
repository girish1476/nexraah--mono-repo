import { Page } from '@playwright/test';
import { RoleCode } from '../src/lib/permissions';
import { mintAccessToken } from '../src/mocks';

/**
 * Signs in as the given role before first navigation.
 *
 * The token is minted here rather than read from a checked-in constant. The
 * six pre-signed JWTs this used to draw on carried a fixed `exp`, went past
 * it, and took every non-mock sign-in down with them; a token minted at the
 * moment the spec runs cannot go stale on the shelf.
 *
 * Only `localStorage.token` is seeded — not the refresh token or expiry that
 * a real sign-in also stores. That combination is deliberate and supported:
 * `ensureFreshToken()` leaves a session with no recorded expiry alone, so the
 * suite gets a session that neither refreshes nor expires mid-test.
 *
 * `localStorage.role` was the pre-refactor flag; `currentRole()`
 * (`src/mocks/index.ts`) has read only the token since role moved into the
 * JWT claims, so every test using the old key was silently running as the
 * mock adapter's OPS fallback regardless of the role it asked for.
 */
export async function setRole(page: Page, role: RoleCode) {
  await page.addInitScript(
    (token) => window.localStorage.setItem('token', token),
    mintAccessToken(role),
  );
}

/**
 * The value inside one stat tile, located by its stable `id` rather than by
 * the words printed on it.
 *
 * These specs pin the *arithmetic* — that "money we hold" really does come
 * to ₹81,920 against the fixtures. They used to find the tile by its label
 * text, which meant every clarity pass over the console's copy broke a dozen
 * value assertions that had nothing to do with wording, and the copy tended
 * to get reverted rather than the specs updated. `Stat.id` (`src/lib/ui.tsx`)
 * is the handle that survives the rewrite; the sentence above the number is
 * free to keep improving.
 */
export function statValue(page: Page, id: string) {
  return page.getByTestId(id).locator('.stat-value');
}
