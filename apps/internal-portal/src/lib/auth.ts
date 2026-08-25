import { MOCKS_ENABLED, mockRefresh, mockSignIn } from '@/mocks';

/**
 * Sign-in, sign-out and the access-token lifecycle — the one place in this
 * app a session token is minted, refreshed or cleared.
 *
 * Two transports, one shape. Part 14 §4.1 is explicit that internal-api
 * never issues a token: it only *verifies* one against the Supabase
 * project's JWKS. So the real sign-in call goes from the browser straight to
 * Supabase Auth, not to internal-api — there is no `POST /auth/login` in
 * `docs/api/`, and there should not be. Against mocks (the default local
 * mode, and the only mode that works without a Supabase instance running)
 * `@/mocks` stands in for that endpoint and mints its own token; everything
 * downstream — `apis.ts`, the guard's `Authorization: Bearer …` contract,
 * `GET /auth/session` — is identical either way.
 *
 * Talking to Supabase over `fetch` rather than `@supabase/supabase-js`: the
 * password grant is one POST and the refresh grant is one more, and the SDK
 * would pull in its own storage, auto-refresh timer and session broadcast
 * channel to sit alongside the ones here and disagree with them. internal-api
 * makes the same call on its side — `lib/jwks.ts` verifies with `jose`
 * directly instead of through the SDK.
 */

/** Read by `apis.ts` on every request. Unchanged key — nothing else moves. */
const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refreshToken';
const EXPIRES_KEY = 'tokenExpiresAt';

/**
 * Refresh this long before the token actually dies. A request that starts
 * valid and lands expired is the failure this margin exists to prevent.
 */
const REFRESH_MARGIN_MS = 60_000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * A sign-in that failed for a reason worth showing someone. Separate from
 * `ApiError` because it never travels through the axios envelope — sign-in
 * is the one call that does not go through `apis.ts`.
 */
export class AuthError extends Error {
  readonly name = 'AuthError';
  constructor(message: string) {
    super(message);
  }
}

/* ---- storage ------------------------------------------------------------ */

function browser(): boolean {
  return typeof window !== 'undefined';
}

export function getToken(): string | null {
  return browser() ? localStorage.getItem(TOKEN_KEY) : null;
}

export function isSignedIn(): boolean {
  return Boolean(getToken());
}

function store(tokens: AuthTokens): void {
  if (!browser()) return;
  localStorage.setItem(TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
  localStorage.setItem(EXPIRES_KEY, String(tokens.expiresAt));
}

export function clearSession(): void {
  if (!browser()) return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(EXPIRES_KEY);
  // The prototype role switcher wrote this and is gone; clear any value left
  // in a browser that used the old build, or it outlives its own feature.
  localStorage.removeItem('role');
}

function expiresAt(): number {
  const raw = browser() ? localStorage.getItem(EXPIRES_KEY) : null;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/* ---- the Supabase Auth token endpoint ----------------------------------- */

function supabaseConfig(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new AuthError(
      'Sign-in is not configured on this deployment. NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY must both be set.',
    );
  }
  return { url, anonKey };
}

interface GoTrueTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * GoTrue reports a bad password as `400 invalid_grant`, an unconfirmed email
 * as `400 email_not_confirmed`, and rate-limiting as `429`. All three read as
 * "wrong password" to someone staring at the form, so each gets its own line
 * — part of why sign-in does not reuse the generic API error mapper.
 */
async function grant(body: Record<string, string>, grantType: string): Promise<AuthTokens> {
  const { url, anonKey } = supabaseConfig();

  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/token?grant_type=${grantType}`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('Could not reach the sign-in service. Check your connection and try again.');
  }

  const payload = (await response.json().catch(() => null)) as
    | (Partial<GoTrueTokens> & { error_code?: string; error_description?: string; msg?: string })
    | null;

  if (!response.ok) {
    throw new AuthError(signInMessage(response.status, payload?.error_code, payload));
  }
  if (!payload?.access_token || !payload.refresh_token) {
    throw new AuthError('The sign-in service returned an unexpected response.');
  }

  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
}

function signInMessage(
  status: number,
  code: string | undefined,
  payload: { error_description?: string; msg?: string } | null,
): string {
  if (status === 429) return 'Too many sign-in attempts. Wait a minute and try again.';
  if (code === 'email_not_confirmed') return 'This account has not been confirmed yet.';
  if (status === 400 || status === 401) return 'That email and password do not match an account.';
  return payload?.error_description ?? payload?.msg ?? 'Sign-in failed. Try again.';
}

/* ---- the operations this app actually performs -------------------------- */

/**
 * Exchanges an email and password for a token pair and stores it. Throws
 * `AuthError` with a line that can be shown as-is; the caller never has to
 * translate a status code.
 */
export async function signIn(email: string, password: string): Promise<void> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !password) throw new AuthError('Enter your email and password.');

  const tokens = MOCKS_ENABLED
    ? await mockSignIn(trimmed, password)
    : await grant({ email: trimmed, password }, 'password');

  store(tokens);
}

/**
 * Trades the refresh token for a fresh pair. Returns false — rather than
 * throwing — when there is nothing to refresh with or the refresh token has
 * itself expired, because every caller's response to that is the same: treat
 * the session as over and send the person to sign in.
 */
export async function refreshSession(): Promise<boolean> {
  const refreshToken = browser() ? localStorage.getItem(REFRESH_KEY) : null;
  if (!refreshToken) return false;

  try {
    const tokens = MOCKS_ENABLED
      ? await mockRefresh(refreshToken)
      : await grant({ refresh_token: refreshToken }, 'refresh_token');
    store(tokens);
    return true;
  } catch {
    return false;
  }
}

/**
 * Called before the session bootstrap and before any request that would
 * otherwise carry a token about to die. A token with time left on it is left
 * alone, so this is cheap enough to sit in front of every page load.
 */
export async function ensureFreshToken(): Promise<void> {
  if (!isSignedIn()) return;
  const remaining = expiresAt() - Date.now();
  // An absent or unparseable expiry means a session stored by an older build;
  // leave it be and let a 401 drive the refresh rather than guessing it dead.
  if (expiresAt() === 0 || remaining > REFRESH_MARGIN_MS) return;
  await refreshSession();
}

/**
 * Ends the session locally, then tells Supabase to revoke the refresh token.
 * Local clearing happens first and unconditionally: a network failure on the
 * way out must never leave someone still signed in on a shared machine.
 */
export function signOut(): void {
  const refreshToken = browser() ? localStorage.getItem(REFRESH_KEY) : null;
  clearSession();

  if (MOCKS_ENABLED || !refreshToken) return;
  try {
    const { url, anonKey } = supabaseConfig();
    void fetch(`${url}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${refreshToken}` },
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // supabaseConfig() throwing here means the app was never configured for
    // real auth, in which case there is no remote session to revoke.
  }
}
