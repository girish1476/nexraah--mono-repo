// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { administrator } from './admin-session';

/**
 * With the real backend there is no `nx_session` cookie — sign-in went to
 * Supabase — so the console's server asks the backend who holds the token
 * (27 Oct 2026). The backend is stood in here.
 */

const request = (authorization?: string) =>
  new NextRequest('https://console.example/api/integrations', { headers: authorization ? { authorization } : {} });

const backend = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', '0');
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example/api/v1/');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('who is an administrator, with the real backend', () => {
  it('an administrator’s token is let through, checked by the backend', async () => {
    const fetch = backend(200, { data: { email: 'admin@nexusfreight.in', role: 'ADMIN' } });
    vi.stubGlobal('fetch', fetch);
    expect(await administrator(request('Bearer tok'))).toEqual({ email: 'admin@nexusfreight.in' });
    expect(fetch).toHaveBeenCalledWith('https://api.example/api/v1/auth/session', expect.objectContaining({ headers: { Authorization: 'Bearer tok' } }));
  });

  it('anyone else is refused', async () => {
    vi.stubGlobal('fetch', backend(200, { data: { email: 'ops@nexusfreight.in', role: 'OPS' } }));
    const who = await administrator(request('Bearer tok'));
    expect('refused' in who && who.refused.status).toBe(403);
  });

  it('a token the backend does not accept is told to sign in again', async () => {
    vi.stubGlobal('fetch', backend(401, { error: { code: 'UNAUTHORIZED' } }));
    const who = await administrator(request('Bearer expired'));
    expect('refused' in who && who.refused.status).toBe(401);
  });

  it('a backend that cannot be reached is said so, not taken for a refusal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('ECONNREFUSED'))));
    const who = await administrator(request('Bearer tok'));
    expect('refused' in who && who.refused.status).toBe(502);
  });

  it('on the demo data a token is not enough — the signed cookie is still needed', async () => {
    vi.stubEnv('NEXT_PUBLIC_USE_MOCKS', '1');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const who = await administrator(request('Bearer tok'));
    expect('refused' in who).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
});
