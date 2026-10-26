import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import {
  INTEGRATIONS,
  integrationById,
  type IntegrationDef,
  type IntegrationId,
  type IntegrationState,
  type IntegrationSwitches,
} from '../integrations';
import { AGENT, nearest } from './fuel';
import { envMailConfig, sendEmail, type MailConfig, type OutgoingEmail } from './mailer';
import { command, peopleStoreConfigured } from './people-store';

/**
 * The settings an administrator keeps on the Integrations screen.
 *
 * One hash in the shared database (the same Upstash Redis as the people list),
 * one JSON entry per service. A key is stored sealed — AES-256-GCM under a key
 * derived from SIGNIN_SECRET — so the database alone does not give it away, and
 * it is never sent back to a browser: the screen sees its last four characters.
 *
 * Everything here sits on top of the deployment's own settings (Vercel →
 * Environment Variables), never instead of them. A value saved here is used
 * first; with nothing saved, the deployment's own is used, as before this
 * screen existed. For sign-in email that matters: if the saved key stops
 * working, the deployment's key is tried next, so a wrong key typed here can
 * never stop everyone signing in — including the administrator who would fix it.
 */

const KEY = 'nexraah:integrations';
/** Settings are read on most requests that use a service; a few seconds' memory spares the database. */
const MEMO_MS = 15_000;
const MAX_VALUE = 300;

export interface StoredIntegration {
  enabled?: boolean;
  values?: Record<string, string>;
  /** Sealed with `sealSecret`. */
  secrets?: Record<string, string>;
  lastTest?: { at: string; ok: boolean; message: string } | null;
  updatedAt?: string;
  updatedBy?: string;
}

type All = Partial<Record<IntegrationId, StoredIntegration>>;

let memo: { at: number; all: All } | null = null;

/* ---- sealing keys ---------------------------------------------------------- */

function sealingKey(): Buffer | null {
  const s = process.env.SIGNIN_SECRET;
  return s && s.length >= 16 ? createHash('sha256').update(`nexraah-integrations:${s}`).digest() : null;
}

export function sealSecret(plain: string): string {
  const key = sealingKey();
  if (!key) throw new Error('SIGNIN_SECRET is not set, so a key cannot be stored safely.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')}`;
}

/** Null for anything that does not open — including a key sealed under a SIGNIN_SECRET since changed. */
export function openSecret(sealed: string | undefined): string | null {
  const key = sealingKey();
  if (!key || !sealed?.startsWith('v1.')) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* ---- reading and saving ---------------------------------------------------- */

/** Settings can be saved only with the shared database and a secret to seal keys with. */
export function integrationsStoreReady(): boolean {
  return peopleStoreConfigured() && sealingKey() !== null;
}

async function readAll(fresh = false): Promise<All> {
  if (!peopleStoreConfigured()) return {};
  if (!fresh && memo && Date.now() - memo.at < MEMO_MS) return memo.all;
  // HGETALL answers as a flat [field, value, field, value, …] list.
  const flat = (await command<string[] | null>(['HGETALL', KEY])) ?? [];
  const all: All = {};
  for (let i = 0; i + 1 < flat.length; i += 2) {
    if (!integrationById(flat[i])) continue;
    try {
      all[flat[i] as IntegrationId] = JSON.parse(flat[i + 1]) as StoredIntegration;
    } catch {
      // A damaged entry is treated as nothing saved.
    }
  }
  memo = { at: Date.now(), all };
  return all;
}

/** For a service in use: a database that cannot be read means the deployment's own settings, not a failure. */
async function readOrNothing(): Promise<All> {
  try {
    return await readAll();
  } catch (e) {
    console.error('[integrations] settings could not be read:', (e as Error).message);
    return {};
  }
}

async function writeOne(id: IntegrationId, record: StoredIntegration): Promise<void> {
  await command<number>(['HSET', KEY, id, JSON.stringify(record)]);
  memo = null;
}

/* ---- what a service is set to ---------------------------------------------- */

function hostValue(def: IntegrationDef, key: string, env?: string[]): string | null {
  if (def.id === 'email' && key === 'provider') return envMailConfig()?.provider ?? null;
  if (def.id === 'email' && key === 'apiKey') return envMailConfig()?.apiKey ?? null;
  for (const name of env ?? []) {
    const value = process.env[name];
    if (value) return value;
  }
  return null;
}

interface Resolved {
  value: Record<string, string | null>;
  source: Record<string, 'here' | 'host' | null>;
}

function resolve(def: IntegrationDef, record: StoredIntegration | undefined): Resolved {
  const value: Resolved['value'] = {};
  const source: Resolved['source'] = {};
  for (const field of def.fields) {
    const here = field.secret ? openSecret(record?.secrets?.[field.key]) : record?.values?.[field.key] || null;
    const host = hostValue(def, field.key, field.env);
    value[field.key] = here ?? host;
    source[field.key] = here ? 'here' : host ? 'host' : null;
  }
  return { value, source };
}

function mailConfigOf(r: Resolved): MailConfig | null {
  const { provider, apiKey, from, replyTo } = r.value;
  if ((provider !== 'brevo' && provider !== 'resend') || !apiKey || !from) return null;
  return { provider, apiKey, from, ...(replyTo ? { replyTo } : {}) };
}

function missingFor(def: IntegrationDef, r: Resolved): string | null {
  if (def.id === 'database') {
    return peopleStoreConfigured() ? null : 'Add Upstash Redis in Vercel → Storage, connect it to this project, then redeploy.';
  }
  if (def.id === 'email') {
    const lacking = [
      !r.value.provider && 'a mail service',
      !r.value.apiKey && 'an API key',
      !r.value.from && 'a sender address',
    ].filter(Boolean);
    return lacking.length ? `Needs ${lacking.join(', ')}.` : null;
  }
  return null;
}

const hint = (secret: string) => `••••${secret.slice(-4)}`;

function stateOf(def: IntegrationDef, record: StoredIntegration | undefined): IntegrationState {
  const r = resolve(def, record);
  const values: Record<string, string> = {};
  const secrets: IntegrationState['secrets'] = {};
  for (const field of def.fields) {
    const v = r.value[field.key];
    if (field.secret) secrets[field.key] = { set: !!v, hint: v ? hint(v) : null, source: r.source[field.key] };
    else values[field.key] = v ?? '';
  }
  const missing = missingFor(def, r);
  return {
    id: def.id,
    enabled: def.canSwitchOff ? record?.enabled !== false : true,
    values,
    secrets,
    sources: r.source,
    ready: !missing,
    missing,
    lastTest: record?.lastTest ?? null,
    updatedAt: record?.updatedAt ?? null,
    updatedBy: record?.updatedBy ?? null,
  };
}

/** Every service, as the Integrations screen shows it. Reads the database afresh. */
export async function integrationStates(): Promise<IntegrationState[]> {
  const all = await readAll(true);
  return INTEGRATIONS.map((def) => stateOf(def, all[def.id]));
}

/** Whether a service may be used. One that cannot be switched off is always on. */
export async function integrationOn(id: IntegrationId): Promise<boolean> {
  if (!integrationById(id)?.canSwitchOff) return true;
  return (await readOrNothing())[id]?.enabled !== false;
}

/** What every visitor's browser is told. */
export async function publicSwitches(): Promise<IntegrationSwitches> {
  const all = await readOrNothing();
  const on = (id: IntegrationId) => all[id]?.enabled !== false;
  return {
    geocode: on('geocode'),
    fuel: on('fuel'),
    ifsc: on('ifsc'),
    reader: on('reader'),
    whatsapp: on('whatsapp'),
    googleMapsKey: all.maps?.values?.googleMapsKey || null,
  };
}

/* ---- sign-in email ---------------------------------------------------------- */

/** The mail settings to try, in order: as set on the screen, then the deployment's own. */
async function mailConfigs(): Promise<MailConfig[]> {
  const email = integrationById('email') as IntegrationDef;
  const screen = mailConfigOf(resolve(email, (await readOrNothing()).email));
  const host = envMailConfig();
  const list = [screen, host].filter((c): c is MailConfig => !!c);
  return list.filter((c, i) => list.findIndex((d) => JSON.stringify(d) === JSON.stringify(c)) === i);
}

/**
 * Sends an email with the screen's settings, and with the deployment's own if
 * those are refused. The first refusal is the one reported.
 */
export async function sendMail(email: OutgoingEmail): Promise<void> {
  const configs = await mailConfigs();
  if (configs.length === 0) return sendEmail(email, fetch, null);
  let first: Error | null = null;
  for (const config of configs) {
    try {
      await sendEmail(email, fetch, config);
      if (first) console.warn('[email] the Integrations settings were refused; sent with the deployment settings:', first.message);
      return;
    } catch (e) {
      first ??= e as Error;
    }
  }
  throw first;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function testEmail(to: string, config: MailConfig): OutgoingEmail {
  const service = config.provider === 'brevo' ? 'Brevo' : 'Resend';
  const text = `This is a test from the Integrations screen of the Nexraah console.\n\nSign-in codes are sent through ${service}, from ${config.from}. If you are reading this, they are reaching inboxes.`;
  return {
    to,
    subject: 'Nexraah: sign-in email is working',
    text,
    // The sender is written "Name <address>": escaped, or the address would vanish as a tag.
    html: text
      .split('\n\n')
      .map((p) => `<p style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5">${escapeHtml(p)}</p>`)
      .join(''),
    refId: randomBytes(8).toString('hex'),
    tag: 'integration-test',
  };
}

/* ---- saving a change -------------------------------------------------------- */

export class SettingRefused extends Error {}

export interface IntegrationChange {
  enabled?: boolean;
  /** A value to save; an empty string goes back to the deployment's own setting. */
  values?: Record<string, string>;
  secrets?: Record<string, string>;
}

/**
 * Saves a change to one service and gives back how it now stands. A change to
 * sign-in email is saved only after a test email with the new settings reached
 * the mail service — sent to the administrator making the change.
 */
export async function saveIntegration(id: IntegrationId, change: IntegrationChange, by: string): Promise<IntegrationState> {
  const def = integrationById(id);
  if (!def) throw new SettingRefused('There is no such integration.');
  if (def.hostOnly) throw new SettingRefused(`${def.name} is set up in the hosting dashboard, not on this screen.`);
  if (!integrationsStoreReady()) throw new SettingRefused('Settings cannot be saved until the shared database is set up.');

  const all = await readAll(true);
  const record: StoredIntegration = { ...all[id], values: { ...all[id]?.values }, secrets: { ...all[id]?.secrets } };
  let settingsChanged = false;

  if (typeof change.enabled === 'boolean') {
    if (!def.canSwitchOff && !change.enabled) throw new SettingRefused(`${def.name} cannot be switched off: the console needs it.`);
    if (def.canSwitchOff) record.enabled = change.enabled;
  }

  for (const field of def.fields) {
    const raw = field.secret ? change.secrets?.[field.key] : change.values?.[field.key];
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length > MAX_VALUE) throw new SettingRefused(`${field.label} is too long.`);
    if (value && field.options && !field.options.some((o) => o.value === value)) {
      throw new SettingRefused(`${field.label}: choose one from the list.`);
    }
    if (value && /[\r\n]/.test(value)) throw new SettingRefused(`${field.label} must be on one line.`);
    const bucket = field.secret ? record.secrets! : record.values!;
    if (!value) delete bucket[field.key];
    else bucket[field.key] = field.secret ? sealSecret(value) : value;
    settingsChanged = true;
  }

  if (id === 'email' && settingsChanged) {
    const config = mailConfigOf(resolve(def, record));
    if (!config) throw new SettingRefused(`Not saved. ${missingFor(def, resolve(def, record)) ?? 'The email settings are not complete.'}`);
    try {
      await sendEmail(testEmail(by, config), fetch, config);
    } catch (e) {
      throw new SettingRefused(`Not saved — the mail service refused a test email with these settings. ${(e as Error).message}`);
    }
    record.lastTest = { at: new Date().toISOString(), ok: true, message: `A test email was sent to ${by}.` };
  }

  record.updatedAt = new Date().toISOString();
  record.updatedBy = by;
  await writeOne(id, record);
  return stateOf(def, record);
}

/* ---- trying a service ------------------------------------------------------- */

const TRY_MS = 10_000;

async function get(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { 'User-Agent': AGENT.replace('nearest fuel lookup for the truck map', 'integration check'), ...init.headers },
    cache: 'no-store',
    signal: AbortSignal.timeout(TRY_MS),
  });
}

async function attempt(id: IntegrationId, admin: string): Promise<string> {
  switch (id) {
    case 'email': {
      const [config] = await mailConfigs();
      if (!config) throw new Error(missingFor(integrationById('email')!, resolve(integrationById('email')!, undefined)) ?? 'Not set up.');
      // The settings in use are tried on their own: a refusal is reported, not hidden by the fallback.
      await sendEmail(testEmail(admin, config), fetch, config);
      return `A test email was sent to ${admin}. Check that inbox, and the spam folder.`;
    }
    case 'database': {
      const pong = await command<string>(['PING']);
      if (pong !== 'PONG') throw new Error(`It answered "${pong}".`);
      return 'The shared database answered.';
    }
    case 'maps': {
      const response = await get('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/5/14/22');
      const type = response.headers.get('content-type') ?? '';
      const bytes = (await response.arrayBuffer()).byteLength;
      // A refusing map server can still answer 200 with a picture saying so: a real tile is a sizeable image.
      if (!response.ok || !type.startsWith('image/') || bytes < 2_000) throw new Error(`Esri answered ${response.status}, ${type || 'no type'}, ${bytes} bytes.`);
      return 'Esri sent a map tile.' + ((await publicSwitches()).googleMapsKey || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
        ? ' The Google key is used by the browser, so it shows on an order’s Tracking tab.'
        : '');
    }
    case 'geocode': {
      const response = await get('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=Pune');
      if (!response.ok) throw new Error(`Nominatim answered ${response.status}.`);
      const hits = (await response.json()) as { lat?: string }[];
      if (!Array.isArray(hits) || !hits[0]?.lat) throw new Error('Nominatim did not find Pune.');
      return 'Nominatim found Pune on the map.';
    }
    case 'fuel': {
      const stations = await nearest(18.5204, 73.8567);
      return `${stations.length} fuel stations found near Pune.`;
    }
    case 'ifsc': {
      const response = await get('https://ifsc.razorpay.com/SBIN0000001');
      if (!response.ok) throw new Error(`Razorpay answered ${response.status}.`);
      const body = (await response.json()) as { BANK?: string; BRANCH?: string };
      if (!body.BANK) throw new Error('Razorpay gave no bank.');
      return `Razorpay named SBIN0000001: ${body.BANK}, ${body.BRANCH ?? ''}.`.replace(/, \.$/, '.');
    }
    case 'reader': {
      const urls = [
        'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
        'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
      ];
      for (const url of urls) {
        const response = await get(url, { method: 'HEAD' });
        if (!response.ok) throw new Error(`jsDelivr answered ${response.status} for ${url.split('/npm/')[1]}.`);
      }
      return 'jsDelivr has both reader libraries ready.';
    }
    case 'whatsapp':
      return 'Nothing to connect: a WhatsApp link opens WhatsApp on the phone or computer it is tapped on.';
  }
}

/** Tries one service for real and keeps the result to show beside it. */
export async function testIntegration(id: IntegrationId, admin: string): Promise<{ ok: boolean; message: string }> {
  let result: { ok: boolean; message: string };
  try {
    result = { ok: true, message: await attempt(id, admin) };
  } catch (e) {
    const reason = (e as Error).name === 'TimeoutError' ? 'It did not answer within 10 seconds.' : (e as Error).message;
    result = { ok: false, message: reason.slice(0, 400) };
  }
  if (integrationsStoreReady()) {
    try {
      const all = await readAll(true);
      await writeOne(id, { ...all[id], lastTest: { at: new Date().toISOString(), ...result } });
    } catch {
      // The result is still shown; it is only not remembered.
    }
  }
  return result;
}
