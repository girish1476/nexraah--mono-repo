import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The shared database, as a map: HGETALL, HSET and PING are all this uses.
const store = vi.hoisted(() => new Map<string, string>());
vi.mock('./people-store', () => ({
  peopleStoreConfigured: () => true,
  command: vi.fn(async (args: (string | number)[]) => {
    const [cmd, , field, value] = args;
    if (cmd === 'HGETALL') return [...store.entries()].flat();
    if (cmd === 'HSET') {
      store.set(String(field), String(value));
      return 1;
    }
    if (cmd === 'PING') return 'PONG';
    return null;
  }),
}));

import {
  SettingRefused,
  integrationOn,
  integrationStates,
  openSecret,
  publicSwitches,
  saveIntegration,
  sealSecret,
  sendMail,
} from './integrations';

const SECRET = 'a-test-secret-that-is-long-enough';
const email = { to: 'me@co.in', subject: 'Code', html: '<p>1</p>', text: '1' };

/** A fetch that answers per mail service: true accepts, false refuses with a 401. */
function mailServices(answers: { brevo?: boolean; resend?: boolean }) {
  return vi.fn(async (url: string) => {
    const accept = url.includes('brevo') ? answers.brevo : answers.resend;
    return accept
      ? new Response('{"id":"x"}', { status: 201 })
      : new Response('{"message":"Key not found"}', { status: 401 });
  });
}

let clock = Date.now();

beforeEach(() => {
  store.clear();
  // Settings are remembered for a few seconds; each test starts past that.
  vi.useFakeTimers({ toFake: ['Date'] });
  clock += 60_000;
  vi.setSystemTime(clock);
  vi.stubEnv('SIGNIN_SECRET', SECRET);
  vi.stubEnv('EMAIL_TEST_OUTBOX', '');
  vi.stubEnv('EMAIL_FROM', 'Nexraah <no-reply@co.in>');
  vi.stubEnv('BREVO_API_KEY', 'xkeysib-from-vercel');
  vi.stubEnv('RESEND_API_KEY', '');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('keys at rest', () => {
  it('are sealed, and open only under the same secret', () => {
    const sealed = sealSecret('xkeysib-123456');
    expect(sealed).not.toContain('xkeysib');
    expect(openSecret(sealed)).toBe('xkeysib-123456');
    vi.stubEnv('SIGNIN_SECRET', 'another-secret-of-enough-length');
    expect(openSecret(sealed)).toBeNull();
  });

  it('never go back to the screen whole', async () => {
    vi.stubGlobal('fetch', mailServices({ resend: true }));
    await saveIntegration('email', { values: { provider: 'resend' }, secrets: { apiKey: 're_abcdefgh1234' } }, 'me@co.in');
    const states = JSON.stringify(await integrationStates());
    expect(states).not.toContain('re_abcdefgh1234');
    expect(states).not.toContain('xkeysib-from-vercel');
    const mail = (await integrationStates()).find((s) => s.id === 'email')!;
    expect(mail.secrets.apiKey).toEqual({ set: true, hint: '••••1234', source: 'here' });
    expect(mail.values.from).toBe('Nexraah <no-reply@co.in>');
    expect(mail.sources.from).toBe('host');
  });
});

describe('sign-in email', () => {
  it('uses the Vercel settings when nothing is saved here', async () => {
    const fetchImpl = mailServices({ brevo: true });
    vi.stubGlobal('fetch', fetchImpl);
    await sendMail(email);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('brevo');
  });

  it('is not saved when the mail service refuses a test with the new settings', async () => {
    vi.stubGlobal('fetch', mailServices({ resend: false }));
    await expect(
      saveIntegration('email', { values: { provider: 'resend' }, secrets: { apiKey: 're_wrong' } }, 'me@co.in'),
    ).rejects.toThrow(SettingRefused);
    expect(store.has('email')).toBe(false);
  });

  it('falls back to the Vercel settings when the saved key stops working', async () => {
    vi.stubGlobal('fetch', mailServices({ resend: true }));
    await saveIntegration('email', { values: { provider: 'resend' }, secrets: { apiKey: 're_good_then_revoked' } }, 'me@co.in');

    const fetchImpl = mailServices({ resend: false, brevo: true });
    vi.stubGlobal('fetch', fetchImpl);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await sendMail(email);
    expect(fetchImpl.mock.calls.map((c) => (String(c[0]).includes('brevo') ? 'brevo' : 'resend'))).toEqual(['resend', 'brevo']);
  });

  it('cannot be switched off', async () => {
    await expect(saveIntegration('email', { enabled: false }, 'me@co.in')).rejects.toThrow(/cannot be switched off/);
  });
});

describe('switches', () => {
  it('are all on until an administrator switches one off', async () => {
    expect(await publicSwitches()).toEqual({
      geocode: true,
      fuel: true,
      ifsc: true,
      reader: true,
      whatsapp: true,
      googleMapsKey: null,
    });
    await saveIntegration('fuel', { enabled: false }, 'me@co.in');
    expect(await integrationOn('fuel')).toBe(false);
    expect((await publicSwitches()).fuel).toBe(false);
    expect(await integrationOn('geocode')).toBe(true);
  });

  it('carry a Google Maps key saved here to the browser', async () => {
    await saveIntegration('maps', { values: { googleMapsKey: 'AIzaTest' } }, 'me@co.in');
    expect((await publicSwitches()).googleMapsKey).toBe('AIzaTest');
  });

  it('refuse a setting the hosting dashboard owns, and a value off the list', async () => {
    await expect(saveIntegration('database', { enabled: true }, 'me@co.in')).rejects.toThrow(/hosting dashboard/);
    await expect(saveIntegration('email', { values: { provider: 'gmail' } }, 'me@co.in')).rejects.toThrow(/choose one/);
  });
});
