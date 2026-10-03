// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CODE_TTL_S,
  MAX_ATTEMPTS,
  checkCode,
  findPerson,
  issueChallenge,
  newCode,
  openChallenge,
  parsePeople,
  realEmailConfigured,
} from './sign-in-code';
import { parseSender, sendEmail } from './mailer';
import { renderSignInEmail } from './sign-in-email';

const SECRET = 'a-long-enough-test-secret-123456';
const NOW = 1_800_000_000;

describe('who may sign in', () => {
  it('reads email=ROLE=Name entries and skips bad ones', () => {
    expect(parsePeople('Me@Co.in=admin=Kavya S, ops@co.in=OPS, bad-entry, x@y.in=NOT_A_ROLE')).toEqual([
      { email: 'me@co.in', role: 'ADMIN', name: 'Kavya S' },
      { email: 'ops@co.in', role: 'OPS', name: 'ops' },
    ]);
    expect(findPerson(' OPS@co.in ', 'ops@co.in=OPS')?.role).toBe('OPS');
    expect(findPerson('stranger@co.in', 'ops@co.in=OPS')).toBeUndefined();
  });
});

describe('the code', () => {
  it('is six digits', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it('works once for its own email within four minutes', () => {
    const c = openChallenge(SECRET, issueChallenge(SECRET, 'me@co.in', '482913', NOW));
    expect(c).not.toBeNull();
    expect(checkCode(SECRET, c, 'me@co.in', '482913', NOW + CODE_TTL_S - 1)).toEqual({ ok: true });
    expect(checkCode(SECRET, c, 'me@co.in', '482913', NOW + CODE_TTL_S + 1)).toMatchObject({ ok: false, reason: 'EXPIRED' });
    expect(checkCode(SECRET, c, 'other@co.in', '482913', NOW)).toMatchObject({ ok: false, reason: 'WRONG_EMAIL' });
  });

  it('counts wrong tries and stops after five', () => {
    let c = openChallenge(SECRET, issueChallenge(SECRET, 'me@co.in', '482913', NOW))!;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const r = checkCode(SECRET, c, 'me@co.in', '000000', NOW + 1);
      expect(r).toMatchObject({ ok: false, reason: 'WRONG_CODE' });
      c = (r as { next: typeof c }).next;
    }
    expect(checkCode(SECRET, c, 'me@co.in', '482913', NOW + 1)).toMatchObject({ ok: false, reason: 'TOO_MANY' });
  });

  it('cannot be forged or edited without the secret', () => {
    const cookie = issueChallenge(SECRET, 'me@co.in', '482913', NOW);
    expect(openChallenge('a-different-secret-of-length', cookie)).toBeNull();
    const [payload, mac] = cookie.split('.');
    const edited = JSON.parse(Buffer.from(payload, 'base64url').toString());
    edited.x = NOW + 10_000;
    expect(openChallenge(SECRET, `${Buffer.from(JSON.stringify(edited)).toString('base64url')}.${mac}`)).toBeNull();
    expect(openChallenge(SECRET, undefined)).toBeNull();
    expect(openChallenge(SECRET, 'garbage')).toBeNull();
  });
});

describe('configuration', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is on only with a secret, a people list, a sender and a mail service', () => {
    vi.stubEnv('SIGNIN_SECRET', SECRET);
    vi.stubEnv('SIGNIN_PEOPLE', 'me@co.in=ADMIN');
    vi.stubEnv('EMAIL_FROM', 'Nexraah <no-reply@co.in>');
    vi.stubEnv('BREVO_API_KEY', '');
    vi.stubEnv('RESEND_API_KEY', '');
    expect(realEmailConfigured()).toBe(false);
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    expect(realEmailConfigured()).toBe(true);
    vi.stubEnv('SIGNIN_SECRET', 'short');
    expect(realEmailConfigured()).toBe(false);
  });
});

describe('sending', () => {
  afterEach(() => vi.unstubAllEnvs());
  const email = { to: 'me@co.in', ...renderSignInEmail({ code: '482913', email: 'me@co.in' }), refId: 'r1' };

  it('reads a sender written as "Name <address>"', () => {
    expect(parseSender('Nexraah <no-reply@co.in>')).toEqual({ name: 'Nexraah', email: 'no-reply@co.in' });
    expect(parseSender('no-reply@co.in')).toEqual({ email: 'no-reply@co.in' });
  });

  it('sends through Brevo from the company sender', async () => {
    vi.stubEnv('EMAIL_TEST_OUTBOX', '');
    vi.stubEnv('EMAIL_FROM', 'Nexraah <no-reply@co.in>');
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    vi.stubEnv('RESEND_API_KEY', '');
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 201 }));
    await sendEmail(email, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    const sent = JSON.parse(String(init.body));
    expect(sent.sender).toEqual({ name: 'Nexraah', email: 'no-reply@co.in' });
    expect(sent.to).toEqual([{ email: 'me@co.in' }]);
    expect(sent.subject).toBe('482913 is your Nexraah sign-in code');
    expect(sent.textContent).toContain('expires in 4 minutes');
  });

  it('sends through Resend when that is the key set', async () => {
    vi.stubEnv('EMAIL_TEST_OUTBOX', '');
    vi.stubEnv('EMAIL_FROM', 'Nexraah <no-reply@co.in>');
    vi.stubEnv('BREVO_API_KEY', '');
    vi.stubEnv('RESEND_API_KEY', 're_test');
    const fetchImpl = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
    await sendEmail(email, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(JSON.parse(String(init.body))).toMatchObject({ from: 'Nexraah <no-reply@co.in>', to: ['me@co.in'] });
  });

  it('reports the service refusing', async () => {
    vi.stubEnv('EMAIL_TEST_OUTBOX', '');
    vi.stubEnv('EMAIL_FROM', 'Nexraah <no-reply@co.in>');
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const fetchImpl = vi.fn(async () => new Response('{"message":"sender not verified"}', { status: 400 }));
    await expect(sendEmail(email, fetchImpl as unknown as typeof fetch)).rejects.toThrow(/400.*sender not verified/);
  });
});
