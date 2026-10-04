import { MOCKS_ENABLED, mockRefresh, mockSendCode, mockSessionFor, mockVerifyCode } from '@/mocks';

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
 * Sign-in is passwordless: an emailed one-time code (`sendSignInCode`, then
 * `verifySignInCode`), offered only to emails an administrator allowed.
 *
 * Talking to Supabase over `fetch` rather than `@supabase/supabase-js`: the
 * code request, the code check and the refresh grant are one POST each, and the SDK
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

/**
 * How long an emailed sign-in code works: four minutes. Supabase → Auth →
 * Email OTP expiration is set to the same 240 seconds; the email says so too.
 */
export const CODE_TTL_S = 240;

let realEmailCheck: Promise<{ realEmail: boolean; peopleStore: boolean }> | null = null;

/**
 * Whether this deployment emails real sign-in codes (app/api/sign-in). When it
 * does, the demo code is switched off: the only way in is the emailed code.
 */
export function realEmailEnabled(): Promise<boolean> {
  return signInStatus().then((s) => s.realEmail);
}

/**
 * Whether the Users screen's list is also kept on the server, so a person an
 * administrator adds there is emailed a code on any device (app/api/people).
 */
export function peopleStoreEnabled(): Promise<boolean> {
  return signInStatus().then((s) => s.peopleStore);
}

function signInStatus(): Promise<{ realEmail: boolean; peopleStore: boolean }> {
  if (!realEmailCheck) {
    realEmailCheck =
      typeof window === 'undefined' || typeof fetch === 'undefined'
        ? Promise.resolve({ realEmail: false, peopleStore: false })
        : fetch('/api/sign-in/status', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : {}))
            .then((j: { realEmail?: boolean; peopleStore?: boolean }) => ({
              realEmail: !!j.realEmail,
              peopleStore: !!j.realEmail && !!j.peopleStore,
            }))
            .catch(() => ({ realEmail: false, peopleStore: false }));
  }
  return realEmailCheck;
}

async function postSignIn(path: 'send' | 'verify', body: Record<string, string>) {
  const response = await fetch(`/api/sign-in/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    person?: { email: string; role: string; name: string; branch?: string | null };
  };
  if (!response.ok) throw new AuthError(payload.error ?? 'Sign-in failed. Try again.');
  return payload;
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

const NOT_ALLOWED = 'This email is not allowed to sign in. Ask an administrator to add it.';

async function callAuth(path: string, body: Record<string, unknown>) {
  const { url, anonKey } = supabaseConfig();
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('Could not reach the sign-in service. Check your connection and try again.');
  }
  const payload = (await response.json().catch(() => null)) as
    | (Partial<GoTrueTokens> & { error_code?: string; code?: string | number; msg?: string; error_description?: string })
    | null;
  return { response, payload, code: payload?.error_code ?? (typeof payload?.code === 'string' ? payload.code : undefined) };
}

/**
 * Step 1 of sign-in: email a one-time code to `email`.
 *
 * There are no passwords. Who may get a code is the administrator's allowed
 * list (Settings → Allowed emails): adding an email there creates its login,
 * and `create_user: false` stops Supabase inventing a login for anyone else —
 * so an address nobody allowed is refused here and no email goes out.
 */
export async function sendSignInCode(email: string): Promise<void> {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) throw new AuthError('Enter your work email.');
  if (MOCKS_ENABLED) {
    if (await realEmailEnabled()) {
      await postSignIn('send', { email: trimmed });
      return;
    }
    await mockSendCode(trimmed).catch((e: Error) => {
      throw new AuthError(e.message);
    });
    return;
  }
  const { response, payload, code } = await callAuth('otp', { email: trimmed, create_user: false });
  if (response.ok) return;
  if (response.status === 429 || code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    throw new AuthError('A code was sent very recently. Wait a minute, then ask for another.');
  }
  if (code === 'otp_disabled' || code === 'signup_disabled' || code === 'user_not_found' || code === 'user_banned') {
    throw new AuthError(NOT_ALLOWED);
  }
  if (response.status === 400 || response.status === 422) throw new AuthError(NOT_ALLOWED);
  throw new AuthError(payload?.msg ?? payload?.error_description ?? 'The code could not be sent. Try again.');
}

/** Step 2: trade the emailed code for a session and store it. */
export async function verifySignInCode(email: string, code: string): Promise<void> {
  const trimmed = email.trim().toLowerCase();
  const token = code.replace(/\s+/g, '');
  if (!trimmed) throw new AuthError('Enter your work email.');
  if (!token) throw new AuthError('Enter the code from the email.');

  if (MOCKS_ENABLED) {
    if (await realEmailEnabled()) {
      const { person } = await postSignIn('verify', { email: trimmed, code: token });
      if (!person) throw new AuthError('Sign-in failed. Try again.');
      store(mockSessionFor(person));
      return;
    }
    const tokens = await mockVerifyCode(trimmed, token).catch((e: Error) => {
      throw new AuthError(e.message);
    });
    store(tokens);
    return;
  }

  const { response, payload, code: errorCode } = await callAuth('verify', { type: 'email', email: trimmed, token });
  if (!response.ok) {
    if (response.status === 429) throw new AuthError('Too many attempts. Wait a minute and try again.');
    if (errorCode === 'user_banned') throw new AuthError(NOT_ALLOWED);
    throw new AuthError('That code is wrong or has expired. Check the latest email, or send a new code.');
  }
  if (!payload?.access_token || !payload.refresh_token) {
    throw new AuthError('The sign-in service returned an unexpected response.');
  }
  store({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
  });
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

  if (MOCKS_ENABLED) {
    // Ends the server's own session too (set when an emailed code was
    // accepted), so the next person on this browser does not inherit it.
    if (browser() && typeof fetch !== 'undefined') {
      void fetch('/api/sign-in/out', { method: 'POST', credentials: 'same-origin', keepalive: true }).catch(
        () => undefined,
      );
    }
    return;
  }
  if (!refreshToken) return;
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
