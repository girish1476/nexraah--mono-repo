// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE, SESSION_TTL_S, issueSession, openSession } from '@/lib/server/sign-in-code';
import { POST } from './route';

const SECRET = 'a-long-enough-test-secret-123456';
const NOW = Math.floor(Date.now() / 1000);

const asked = (cookie?: string) =>
  POST(
    new NextRequest('https://console.example/api/sign-in/session', {
      method: 'POST',
      headers: cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {},
    }),
  );

beforeEach(() => {
  vi.stubEnv('SIGNIN_SECRET', SECRET);
  vi.stubEnv('SIGNIN_PEOPLE', 'me@co.in=ADMIN=Me');
  vi.stubEnv('EMAIL_FROM', 'Nexraah <no-reply@co.in>');
  vi.stubEnv('BREVO_API_KEY', 'key');
  vi.stubEnv('KV_REST_API_URL', '');
  vi.stubEnv('KV_REST_API_TOKEN', '');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});
afterEach(() => vi.unstubAllEnvs());

describe("keeping the server's session going", () => {
  it('gives a good session another week, from now', async () => {
    const response = await asked(issueSession(SECRET, 'me@co.in', NOW - 6 * 86_400));
    expect(response.status).toBe(200);
    const cookie = response.cookies.get(SESSION_COOKIE);
    expect(cookie?.maxAge).toBe(SESSION_TTL_S);
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'strict', path: '/api' });
    expect(openSession(SECRET, cookie?.value, NOW + SESSION_TTL_S - 60)).toBe('me@co.in');
  });

  it('says a week-old session has ended, and does not bring it back', async () => {
    const response = await asked(issueSession(SECRET, 'me@co.in', NOW - SESSION_TTL_S - 60));
    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('says so with no cookie at all, or one signed with another secret', async () => {
    expect((await asked()).status).toBe(401);
    expect((await asked(issueSession('another-secret-of-the-same-length', 'me@co.in'))).status).toBe(401);
  });

  it('ends the session of someone no longer allowed in', async () => {
    const response = await asked(issueSession(SECRET, 'gone@co.in'));
    expect(response.status).toBe(401);
    expect(response.cookies.get(SESSION_COOKIE)).toBeUndefined();
  });

  it('a deployment without email sign-in does not call it over', async () => {
    vi.stubEnv('SIGNIN_SECRET', '');
    expect((await asked()).status).toBe(503);
  });
});
