import { Page } from '@playwright/test';
import { RoleCode } from '../src/lib/permissions';
import { branchedAccount, mintAccessToken } from '../src/mocks';
import type { FixtureAccount } from '../src/mocks/db';

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
 * Takes a role — meaning that role's default, unscoped person — or a specific
 * `FixtureAccount` when the test is about *who* rather than *what role*. That
 * distinction only started mattering when the BRANCH_MGR merge moved branch
 * scoping onto the user record: two Operations people can now see different
 * things, and a role alone can no longer say which of them is signed in.
 * `scopedOperations()` below is the branched one.
 *
 * `localStorage.role` was the pre-refactor flag; `currentRole()`
 * (`src/mocks/index.ts`) has read only the token since role moved into the
 * JWT claims, so every test using the old key was silently running as the
 * mock adapter's OPS fallback regardless of the role it asked for.
 */
export async function setRole(page: Page, who: RoleCode | FixtureAccount) {
  await page.addInitScript(
    (token) => window.localStorage.setItem('token', token),
    mintAccessToken(who),
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

/**
 * The branch-scoped Operations account (Sunita Rao, Nashik).
 *
 * Throws rather than returning undefined: a spec that asked for the scoped
 * account and silently got the unscoped one would still pass every assertion
 * about rows being *present*, and quietly stop testing the narrowing it
 * exists to prove.
 */
export function scopedOperations(): FixtureAccount {
  const account = branchedAccount('OPS');
  if (!account) throw new Error('No branch-scoped OPS fixture account — see ACCOUNTS in src/mocks/db.ts');
  return account;
}
