import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  ensureFreshToken,
  getToken,
  isSignedIn,
  refreshSession,
  sendSignInCode,
  signOut,
  verifySignInCode,
} from './auth';
import { mintAccessToken } from '@/mocks';
import { DEMO_CODE, USERS } from '@/mocks/db';

/**
 * These run in mock mode (`NEXT_PUBLIC_USE_MOCKS` unset, which defaults on),
 * so sign-in exercises the fixture path rather than calling Supabase. The
 * two transports converge on one `AuthTokens` shape, and everything below the
 * transport — storage, expiry accounting, refresh, sign-out — is shared, so
 * that is what these cover.
 */

const OPS_EMAIL = USERS.OPS.email;

/** Both steps of email + one-time-code sign-in. */
async function signIn(email: string, code = DEMO_CODE) {
  await sendSignInCode(email);
  await verifySignInCode(email, code);
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('email one-time code sign-in', () => {
  it('stores an access token, a refresh token and an expiry', async () => {
    await signIn(OPS_EMAIL);

    expect(getToken()).toBeTruthy();
    expect(localStorage.getItem('refreshToken')).toBeTruthy();
    expect(Number(localStorage.getItem('tokenExpiresAt'))).toBeGreaterThan(Date.now());
    expect(isSignedIn()).toBe(true);
  });

  it('accepts the email in any case, with surrounding space', async () => {
    await signIn(`  ${OPS_EMAIL.toUpperCase()}  `);
    expect(isSignedIn()).toBe(true);
  });

  it('refuses to send a code to an email nobody allowed', async () => {
    await expect(sendSignInCode('nobody@nexraah.in')).rejects.toThrow(/not allowed to sign in/i);
  });

  it('rejects a wrong code and stores nothing', async () => {
    await sendSignInCode(OPS_EMAIL);
    await expect(verifySignInCode(OPS_EMAIL, '000000')).rejects.toThrow(/wrong or has expired/i);
    expect(isSignedIn()).toBe(false);
  });

  it('asks for the email before sending anything', async () => {
    await expect(sendSignInCode('   ')).rejects.toThrow(/enter your work email/i);
  });

  it('asks for the code before checking anything', async () => {
    await expect(verifySignInCode(OPS_EMAIL, '')).rejects.toThrow(/enter the code/i);
  });
});

describe('the role travels in the token', () => {
  it('signs each fixture account in as its own role', async () => {
    for (const role of ['OPS', 'FINANCE', 'ADMIN'] as const) {
      localStorage.clear();
      await signIn(USERS[role].email);
      const claims = JSON.parse(atob(getToken()!.split('.')[1]));
      expect(claims.role).toBe(role);
      expect(claims.email).toBe(USERS[role].email);
    }
  });
});

describe('refreshSession', () => {
  it('is a no-op that reports failure when there is nothing to refresh with', async () => {
    expect(await refreshSession()).toBe(false);
  });

  it('rotates both tokens and pushes the expiry out', async () => {
    await signIn(OPS_EMAIL);
    const before = getToken();
    const beforeRefresh = localStorage.getItem('refreshToken');

    expect(await refreshSession()).toBe(true);
    expect(getToken()).not.toBe(before);
    expect(localStorage.getItem('refreshToken')).not.toBe(beforeRefresh);
    expect(Number(localStorage.getItem('tokenExpiresAt'))).toBeGreaterThan(Date.now());
  });

  it('reports failure and leaves the session alone when the refresh token is junk', async () => {
    await signIn(OPS_EMAIL);
    const accessToken = getToken();
    localStorage.setItem('refreshToken', 'not.a.token');

    expect(await refreshSession()).toBe(false);
    // Deciding the session is over belongs to the caller — a failed refresh
    // during a network blip must not sign someone out on its own.
    expect(getToken()).toBe(accessToken);
  });
});

describe('ensureFreshToken', () => {
  it('leaves a token with time left on it alone', async () => {
    await signIn(OPS_EMAIL);
    const before = getToken();

    await ensureFreshToken();
    expect(getToken()).toBe(before);
  });

  it('renews a token inside the expiry margin', async () => {
    await signIn(OPS_EMAIL);
    const before = getToken();
    // 30s left — inside the 60s margin, and not yet expired, so this is the
    // case the margin exists for: still valid, but not for the whole request.
    localStorage.setItem('tokenExpiresAt', String(Date.now() + 30_000));

    await ensureFreshToken();
    expect(getToken()).not.toBe(before);
  });

  it('leaves a session with no recorded expiry alone', async () => {
    // What e2e/helpers.ts seeds, and what a session stored by an older build
    // looks like. Guessing it dead would sign the suite out on every run.
    const token = mintAccessToken('OPS');
    localStorage.setItem('token', token);

    await ensureFreshToken();
    expect(getToken()).toBe(token);
  });

  it('does nothing at all when signed out', async () => {
    await ensureFreshToken();
    expect(isSignedIn()).toBe(false);
  });
});

describe('signOut', () => {
  it('clears every trace of the session', async () => {
    await signIn(OPS_EMAIL);
    signOut();

    expect(getToken()).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('tokenExpiresAt')).toBeNull();
    expect(isSignedIn()).toBe(false);
  });

  it('clears the retired role-switcher key left by an older build', async () => {
    localStorage.setItem('role', 'ADMIN');
    await signIn(OPS_EMAIL);
    clearSession();

    expect(localStorage.getItem('role')).toBeNull();
  });
});
