import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSession,
  ensureFreshToken,
  getToken,
  isSignedIn,
  refreshSession,
  signIn,
  signOut,
} from './auth';
import { mintAccessToken } from '@/mocks';
import { DEMO_PASSWORD, USERS } from '@/mocks/db';

/**
 * These run in mock mode (`NEXT_PUBLIC_USE_MOCKS` unset, which defaults on),
 * so `signIn` exercises the fixture path rather than calling Supabase. The
 * two transports converge on one `AuthTokens` shape, and everything below the
 * transport — storage, expiry accounting, refresh, sign-out — is shared, so
 * that is what these cover.
 */

const OPS_EMAIL = USERS.OPS.email;

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe('signIn', () => {
  it('stores an access token, a refresh token and an expiry', async () => {
    await signIn(OPS_EMAIL, DEMO_PASSWORD);

    expect(getToken()).toBeTruthy();
    expect(localStorage.getItem('refreshToken')).toBeTruthy();
    expect(Number(localStorage.getItem('tokenExpiresAt'))).toBeGreaterThan(Date.now());
    expect(isSignedIn()).toBe(true);
  });

  it('accepts the email in any case, with surrounding space', async () => {
    await signIn(`  ${OPS_EMAIL.toUpperCase()}  `, DEMO_PASSWORD);
    expect(isSignedIn()).toBe(true);
  });

  it('rejects a wrong password and stores nothing', async () => {
    await expect(signIn(OPS_EMAIL, 'not-the-password')).rejects.toThrow(
      /do not match an account/i,
    );
    expect(isSignedIn()).toBe(false);
  });

  it('rejects an unknown email with the same message as a wrong password', async () => {
    // Identical wording on purpose — a distinguishable failure would let
    // someone enumerate who has an account here.
    const unknown = await signIn('nobody@nexraah.in', DEMO_PASSWORD).catch((e) => e.message);
    const wrongPassword = await signIn(OPS_EMAIL, 'wrong').catch((e) => e.message);
    expect(unknown).toBe(wrongPassword);
  });

  it('rejects an empty password without consulting the account list', async () => {
    await expect(signIn(OPS_EMAIL, '')).rejects.toThrow(/enter your email and password/i);
  });
});

describe('the role travels in the token', () => {
  it('signs each fixture account in as its own role', async () => {
    for (const role of ['OPS', 'FINANCE', 'ADMIN'] as const) {
      localStorage.clear();
      await signIn(USERS[role].email, DEMO_PASSWORD);
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
    await signIn(OPS_EMAIL, DEMO_PASSWORD);
    const before = getToken();
    const beforeRefresh = localStorage.getItem('refreshToken');

    expect(await refreshSession()).toBe(true);
    expect(getToken()).not.toBe(before);
    expect(localStorage.getItem('refreshToken')).not.toBe(beforeRefresh);
    expect(Number(localStorage.getItem('tokenExpiresAt'))).toBeGreaterThan(Date.now());
  });

  it('reports failure and leaves the session alone when the refresh token is junk', async () => {
    await signIn(OPS_EMAIL, DEMO_PASSWORD);
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
    await signIn(OPS_EMAIL, DEMO_PASSWORD);
    const before = getToken();

    await ensureFreshToken();
    expect(getToken()).toBe(before);
  });

  it('renews a token inside the expiry margin', async () => {
    await signIn(OPS_EMAIL, DEMO_PASSWORD);
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
    await signIn(OPS_EMAIL, DEMO_PASSWORD);
    signOut();

    expect(getToken()).toBeNull();
    expect(localStorage.getItem('refreshToken')).toBeNull();
    expect(localStorage.getItem('tokenExpiresAt')).toBeNull();
    expect(isSignedIn()).toBe(false);
  });

  it('clears the retired role-switcher key left by an older build', async () => {
    localStorage.setItem('role', 'ADMIN');
    await signIn(OPS_EMAIL, DEMO_PASSWORD);
    clearSession();

    expect(localStorage.getItem('role')).toBeNull();
  });
});
