import { describe, expect, it, vi } from 'vitest';
import { fast2smsGateway, msg91Gateway, smsGatewayFromEnv } from './sms';
import { sampleSmsValues, smsSetup } from './sms-setup';

const answer = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('MSG91', () => {
  it('posts the template and the values as VAR1, VAR2… to the flow API, with the 91 prefix', async () => {
    const fetch = answer(200, { type: 'success', message: '5e1e93cad6fc054d8e759a5b' });
    const sent = await msg91Gateway('KEY', fetch).send({ mobile: '9876543210', templateId: 'T1', values: ['Advance', '₹31,304', '100242', 'UTR1'] });
    expect(sent.providerRef).toBe('5e1e93cad6fc054d8e759a5b');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://control.msg91.com/api/v5/flow');
    expect((init.headers as Record<string, string>).authkey).toBe('KEY');
    expect(JSON.parse(String(init.body))).toEqual({
      template_id: 'T1',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', VAR1: 'Advance', VAR2: '₹31,304', VAR3: '100242', VAR4: 'UTR1' }],
    });
  });

  it('says what MSG91 said when it refuses', async () => {
    const fetch = answer(200, { type: 'error', message: 'Invalid template id' });
    await expect(msg91Gateway('KEY', fetch).send({ mobile: '9876543210', templateId: 'X', values: [] })).rejects.toThrow(/Invalid template id/);
  });
});

describe('Fast2SMS', () => {
  it('sends on the DLT route with the header, the message id and pipe-separated values', async () => {
    const fetch = answer(200, { return: true, request_id: 'lwdtp7cjyqxvfe9', message: ['Message sent successfully'] });
    const sent = await fast2smsGateway('KEY', 'NEXRAH', fetch).send({ mobile: '9876543210', templateId: '111111', values: ['Trip 100242', 'a|b'] });
    expect(sent.providerRef).toBe('lwdtp7cjyqxvfe9');
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const q = new URL(url).searchParams;
    expect(url.startsWith('https://www.fast2sms.com/dev/bulkV2?')).toBe(true);
    expect([q.get('route'), q.get('sender_id'), q.get('message'), q.get('numbers')]).toEqual(['dlt', 'NEXRAH', '111111', '9876543210']);
    expect(q.get('variables_values')).toBe('Trip 100242|a/b'); // a pipe inside a value would split it
    expect((init.headers as Record<string, string>).authorization).toBe('KEY');
  });

  it('says what Fast2SMS said when it refuses', async () => {
    const fetch = answer(400, { return: false, status_code: 424, message: 'Invalid Message ID' });
    await expect(fast2smsGateway('KEY', 'NEXRAH', fetch).send({ mobile: '9876543210', templateId: '1', values: [] })).rejects.toThrow(/424.*Invalid Message ID/);
  });

  it('keeps each value within DLT’s 30 characters', async () => {
    const fetch = answer(200, { return: true, request_id: 'r' });
    await fast2smsGateway('KEY', 'NEXRAH', fetch).send({ mobile: '9876543210', templateId: '1', values: ['x'.repeat(50)] });
    const q = new URL((fetch.mock.calls[0] as unknown as [string])[0]).searchParams;
    expect(q.get('variables_values')).toHaveLength(30);
  });
});

describe('the SMS set-up', () => {
  it('is off until a gateway, its key (and for Fast2SMS its header) are set', () => {
    expect(smsGatewayFromEnv({})).toBeNull();
    expect(smsGatewayFromEnv({ SMS_PROVIDER: 'msg91' })).toBeNull();
    expect(smsGatewayFromEnv({ SMS_PROVIDER: 'msg91', SMS_API_KEY: 'k' })?.name).toBe('msg91');
    expect(smsGatewayFromEnv({ SMS_PROVIDER: 'fast2sms', SMS_API_KEY: 'k' })).toBeNull();
    expect(smsGatewayFromEnv({ SMS_PROVIDER: 'FAST2SMS', SMS_API_KEY: 'k', SMS_SENDER_ID: 'NEXRAH' })?.name).toBe('fast2sms');
    expect(smsGatewayFromEnv({ SMS_PROVIDER: 'somebody-else', SMS_API_KEY: 'k' })).toBeNull();
  });

  it('names what is still missing, and which notifications have a template', () => {
    const none = smsSetup({});
    expect(none.ready).toBe(false);
    expect(none.missing).toEqual(['SMS_PROVIDER (msg91 or fast2sms)', 'SMS_API_KEY', 'SMS_TEMPLATES']);

    const some = smsSetup({ SMS_PROVIDER: 'fast2sms', SMS_API_KEY: 'k', SMS_TEMPLATES: '{"payment.released":"111"}' });
    expect(some.missing).toEqual(['SMS_SENDER_ID']);
    expect(some.templates.find((t) => t.event === 'payment.released')?.templateId).toBe('111');
    expect(some.templates.find((t) => t.event === 'pod.due')?.templateId).toBeNull();

    const done = smsSetup({ SMS_PROVIDER: 'msg91', SMS_API_KEY: 'k', SMS_TEMPLATES: '{"payment.released":"T1"}' });
    expect(done).toMatchObject({ ready: true, missing: [] });
  });

  it('tests a notification with its real wording: payment advice fills four values', () => {
    expect(sampleSmsValues('payment.released')).toHaveLength(4);
    expect(sampleSmsValues('payment.released')[0]).toBe('Advance');
  });
});
