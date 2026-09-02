import { USE_MOCK, mock } from './mock';

/**
 * Sign-in, sign-out and the access-token lifecycle for the transporter portal.
 *
 * This is the mirror of `internal-portal/src/lib/auth.ts`, and deliberately so
 * — same storage keys, same refresh margin, same two-transport shape — because
 * the two apps hit the same Supabase project and a transporter and an operator
 * failing to sign in should fail the same way.
 *
 * Why this file did not exist until now: mock mode never needed it. `apis.ts`
 * has read `localStorage.token` since the first commit and *nothing has ever
 * written it*, which is invisible while the fixture adapter ignores auth
 * entirely. The moment `NEXT_PUBLIC_MOCK=0` points this app at a real
 * `vendor-api`, every request goes out with no `Authorization` header and
 * comes back 401, with no screen to recover on — `apis.ts` even carried a
 * commented-out `window.location.href = '/login'` pointing at a route that
 * was never built.
 *
 * Neither portal asks its own backend for a token. Part 14 §4.1: `internal-api`
 * verifies a Supabase JWT against JWKS and never issues one, so the password
 * grant goes from this browser straight to Supabase Auth. `vendor-api` is a
 * proxy with no database and no signing key — it could not mint a token even
 * if the contract allowed it.
 *
 * What makes a token a *transporter's* token is not this file: it is the
 * `vendor_users(auth_user_id, vendor_id)` row the backend resolves from the
 * JWT's subject. An Auth account with no such row signs in successfully here
 * and is then refused by the portal surface — which is the correct division,
 * since only the server can be trusted to decide whose loads these are.
 */

/** The key `apis.ts` already reads on every request. Unchanged deliberately. */
const TOKEN_KEY = 'token';
const REFRESH_KEY = 'refreshToken';
const EXPIRES_KEY = 'tokenExpiresAt';

/**
 * Refresh this long before the token actually dies. Worth more here than in
 * the office: a driver submits a quote on a phone at the edge of coverage, and
 * a request that starts valid and lands expired loses the work.
 */
const REFRESH_MARGIN_MS = 60_000;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/**
 * A sign-in that failed for a reason worth showing someone. Separate from the
 * axios error path because sign-in is the one call that does not go through
 * `apis.ts`.
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
      'Sign-in is not set up on this deployment yet. Ask Nexraah to finish the setup.',
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
 * GoTrue reports a wrong password as `400 invalid_grant`, an unconfirmed
 * account as `400 email_not_confirmed` and rate-limiting as `429`. All three
 * look identical to someone staring at a form on a phone, so each gets its own
 * sentence.
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
    throw new AuthError('Could not reach Nexraah. Check your signal and try again.');
  }

  const payload = (await response.json().catch(() => null)) as
    | (Partial<GoTrueTokens> & { error_code?: string; error_description?: string; msg?: string })
    | null;

  if (!response.ok) {
    throw new AuthError(signInMessage(response.status, payload?.error_code, payload));
  }
  if (!payload?.access_token || !payload.refresh_token) {
    throw new AuthError('Nexraah sent back something unexpected. Try again in a minute.');
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
  if (status === 429) return 'Too many tries. Wait a minute and try again.';
  if (code === 'email_not_confirmed') return 'This login has not been activated yet. Call your Nexraah contact.';
  if (status === 400 || status === 401) return 'That mobile number and password do not match a login.';
  return payload?.error_description ?? payload?.msg ?? 'Could not sign you in. Try again.';
}

/* ---- mock transport ------------------------------------------------------ */

/**
 * Fixture sign-in, so the demo has a real front door rather than a portal that
 * is simply always open. It accepts the one demo login and mints a token that
 * only this app reads — the fixture adapter never inspects it, and a real
 * `vendor-api` would reject it outright, which is the point.
 */
export const DEMO_LOGIN = { phone: '9876543210', password: 'nexraah' };

async function mockGrant(identifier: string, password: string): Promise<AuthTokens> {
  const digits = identifier.replace(/\D/g, '');
  const ok = digits === DEMO_LOGIN.phone && password === DEMO_LOGIN.password;
  const tokens = await mock(
    ok
      ? {
          accessToken: `mock.${digits}.${Date.now()}`,
          refreshToken: `mock-refresh.${digits}`,
          expiresAt: Date.now() + 3600_000,
        }
      : null,
    260,
  );
  if (!tokens) throw new AuthError('That mobile number and password do not match a login.');
  return tokens;
}

/* ---- the operations this app performs ------------------------------------ */

/**
 * Exchanges a login and password for a token pair and stores it.
 *
 * Transporters are identified by mobile number, not email — it is what they
 * give us and what is already on their vendor record. Supabase Auth's password
 * grant is an email grant, so a number is carried as `<digits>@vendor.nexraah.in`,
 * the same address `provision.mjs` creates the Auth account with. Someone who
 * was set up with a real email address can still type it and it passes through
 * untouched.
 */
export async function signIn(identifier: string, password: string): Promise<void> {
  const trimmed = identifier.trim();
  if (!trimmed || !password) throw new AuthError('Enter your mobile number and password.');

  const tokens = USE_MOCK
    ? await mockGrant(trimmed, password)
    : await grant({ email: toLoginEmail(trimmed), password }, 'password');

  store(tokens);
}

/** A 10-digit Indian mobile becomes the address the Auth account was made with. */
export function toLoginEmail(identifier: string): string {
  const value = identifier.trim().toLowerCase();
  if (value.includes('@')) return value;
  const digits = value.replace(/\D/g, '');
  return `${digits}@vendor.nexraah.in`;
}

/**
 * Trades the refresh token for a fresh pair. Returns false rather than throwing
 * when there is nothing to refresh with, because every caller's response to
 * that is the same: treat the session as over.
 */
export async function refreshSession(): Promise<boolean> {
  const refreshToken = browser() ? localStorage.getItem(REFRESH_KEY) : null;
  if (!refreshToken) return false;

  if (USE_MOCK) {
    store({
      accessToken: `mock.refreshed.${Date.now()}`,
      refreshToken,
      expiresAt: Date.now() + 3600_000,
    });
    return true;
  }

  try {
    store(await grant({ refresh_token: refreshToken }, 'refresh_token'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Called before anything that would otherwise carry a token about to die. A
 * token with time left is left alone, so this is cheap enough to sit in front
 * of every page load.
 */
export async function ensureFreshToken(): Promise<void> {
  if (!isSignedIn()) return;
  const remaining = expiresAt() - Date.now();
  // An absent expiry means a session stored by an older build; leave it and let
  // a 401 drive the refresh rather than guessing it dead.
  if (expiresAt() === 0 || remaining > REFRESH_MARGIN_MS) return;
  await refreshSession();
}

/**
 * Ends the session locally, then asks Supabase to revoke the refresh token.
 * Local clearing happens first and unconditionally — a driver signing out on a
 * shared phone must not stay signed in because the network was down.
 */
export function signOut(): void {
  const refreshToken = browser() ? localStorage.getItem(REFRESH_KEY) : null;
  clearSession();

  if (USE_MOCK || !refreshToken) return;
  try {
    const { url, anonKey } = supabaseConfig();
    void fetch(`${url}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${refreshToken}` },
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Never configured for real auth, so there is no remote session to revoke.
  }
}
