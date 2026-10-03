import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HookSignatureError, readHookPayload, verifyHookSignature } from './send-email-hook';
import { CODE_TTL_MINUTES, renderSignInEmail } from './sign-in-email';
import { EmailNotConfiguredError, sendWithResend } from './resend';

const SECRET_BYTES = Buffer.from('a-test-secret-of-some-length-1234');
const SECRET = `v1,whsec_${SECRET_BYTES.toString('base64')}`;
const NOW = 1_800_000_000;

const sign = (id: string, ts: number, body: string, key = SECRET_BYTES) =>
  `v1,${createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')}`;

describe('the Send Email hook signature', () => {
  const body = JSON.stringify({ user: { email: 'anil@nexraah.in' }, email_data: { token: '482913' } });

  it('accepts a request Supabase signed', () => {
    expect(() =>
      verifyHookSignature({ id: 'msg_1', timestamp: String(NOW), signature: sign('msg_1', NOW, body) }, body, SECRET, NOW),
    ).not.toThrow();
  });

  it('accepts one of several signatures (secret rotation)', () => {
    const signature = `v1,bm90LWl0 ${sign('msg_1', NOW, body)}`;
    expect(() => verifyHookSignature({ id: 'msg_1', timestamp: String(NOW), signature }, body, SECRET, NOW)).not.toThrow();
  });

  it('refuses a changed body, a wrong secret, missing headers and a stale timestamp', () => {
    const good = sign('msg_1', NOW, body);
    expect(() =>
      verifyHookSignature({ id: 'msg_1', timestamp: String(NOW), signature: good }, body.replace('482913', '000000'), SECRET, NOW),
    ).toThrow(HookSignatureError);
    expect(() =>
      verifyHookSignature(
        { id: 'msg_1', timestamp: String(NOW), signature: sign('msg_1', NOW, body, Buffer.from('another-secret')) },
        body,
        SECRET,
        NOW,
      ),
    ).toThrow(HookSignatureError);
    expect(() => verifyHookSignature({ id: 'msg_1', timestamp: String(NOW) }, body, SECRET, NOW)).toThrow(HookSignatureError);
    expect(() =>
      verifyHookSignature({ id: 'msg_1', timestamp: String(NOW - 600), signature: sign('msg_1', NOW - 600, body) }, body, SECRET, NOW),
    ).toThrow(/too far/);
  });
});

describe('the hook payload', () => {
  it('reads the address and the code', () => {
    expect(readHookPayload({ user: { email: ' Anil@Nexraah.in ' }, email_data: { token: '482913' } })).toEqual({
      email: 'anil@nexraah.in',
      code: '482913',
    });
  });
  it('refuses a payload without an address or a code', () => {
    expect(() => readHookPayload({ user: {}, email_data: { token: '482913' } })).toThrow();
    expect(() => readHookPayload({ user: { email: 'anil@nexraah.in' }, email_data: {} })).toThrow();
  });
});

describe('the sign-in email', () => {
  const email = renderSignInEmail({ code: '482913', email: 'anil@nexraah.in', logoUrl: 'https://example.test/logo.png' });

  it('carries the code, the four-minute expiry, and no sign-in link', () => {
    expect(CODE_TTL_MINUTES).toBe(4);
    expect(email.subject).toBe('482913 is your Nexraah sign-in code');
    expect(email.html).toContain('482913');
    expect(email.html).toContain('4 minutes');
    expect(email.text).toContain('Your sign-in code: 482913');
    expect(email.text).toContain('expires in 4 minutes');
    expect(email.html).not.toMatch(/href=/);
  });

  it('escapes the address it was sent to', () => {
    const odd = renderSignInEmail({ code: '111111', email: 'a<b>@x.in' });
    expect(odd.html).toContain('a&lt;b&gt;@x.in');
    expect(odd.html).not.toContain('a<b>@x.in');
  });
});

describe('sending through Resend', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refuses to send when it is not configured', async () => {
    vi.stubEnv('RESEND_API_KEY', '');
    vi.stubEnv('EMAIL_FROM', '');
    await expect(sendWithResend({ to: 'a@b.in', subject: 's', html: 'h', text: 't' }, vi.fn())).rejects.toBeInstanceOf(
      EmailNotConfiguredError,
    );
  });

  it('posts the email from the company address, once per hook call', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'Nexraah <no-reply@nexraah.in>');
    vi.stubEnv('EMAIL_REPLY_TO', 'support@nexraah.in');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 'em_1' }), { status: 200 }));
    const result = await sendWithResend(
      { to: 'anil@nexraah.in', subject: 'subj', html: '<p>h</p>', text: 't', idempotencyKey: 'msg_1' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.id).toBe('em_1');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test');
    expect(headers['Idempotency-Key']).toBe('msg_1');
    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({ from: 'Nexraah <no-reply@nexraah.in>', to: ['anil@nexraah.in'], reply_to: 'support@nexraah.in', text: 't' });
  });

  it('reports Resend refusing the email', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test');
    vi.stubEnv('EMAIL_FROM', 'Nexraah <no-reply@nexraah.in>');
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 }));
    await expect(
      sendWithResend({ to: 'a@b.in', subject: 's', html: 'h', text: 't' }, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/403.*domain not verified/);
  });
});
