import { createCipheriv, createECDH, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { SignJWT, importJWK } from 'jose';

/**
 * Browser push — sending one message to one browser, with nothing but Node's
 * own crypto and the JWT library the API already uses.
 *
 * A browser that says yes to notifications hands over an address at its push
 * service (Google's for Chrome, Mozilla's for Firefox, Apple's for Safari) and
 * two keys. A message to it is encrypted for that browser alone (RFC 8291,
 * "aes128gcm") so the push service carries it without reading it, and is
 * signed with the company's own key pair (VAPID, RFC 8292) so the push service
 * knows who sent it. No push service account and no cost.
 *
 * Keys: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (base64url — make a pair with
 * `generateVapidKeys()`, `node scripts/vapid-keys.mjs`) and `VAPID_SUBJECT`
 * (a `mailto:` the push services can write to).
 */

export interface PushTarget {
  endpoint: string;
  /** The browser's public key, base64url, 65 bytes uncompressed. */
  p256dh: string;
  /** The browser's auth secret, base64url, 16 bytes. */
  auth: string;
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
  subject: string;
}

const b64u = (b: Buffer) => b.toString('base64url');
const fromB64u = (s: string) => Buffer.from(s, 'base64url');

/** The record size declared in the header; a payload must fit in one record. */
const RECORD_SIZE = 4096;
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - 17 - 1;

/**
 * Encrypts `plaintext` for one browser (RFC 8291 §3, RFC 8188 one record).
 * `salt` and `senderKeys` are for tests; a real message takes fresh ones.
 */
export function encryptForBrowser(
  plaintext: Buffer,
  target: Pick<PushTarget, 'p256dh' | 'auth'>,
  options: { salt?: Buffer; senderPrivateKey?: Buffer } = {},
): Buffer {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new Error(`Push payload is ${plaintext.length} bytes; at most ${MAX_PAYLOAD_BYTES}.`);
  const uaPublic = fromB64u(target.p256dh);
  const authSecret = fromB64u(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('The browser’s key is not an uncompressed P-256 point.');
  if (authSecret.length < 16) throw new Error('The browser’s auth secret is too short.');

  const sender = createECDH('prime256v1');
  if (options.senderPrivateKey) sender.setPrivateKey(options.senderPrivateKey);
  else sender.generateKeys();
  const asPublic = sender.getPublicKey();
  const ecdhSecret = sender.computeSecret(uaPublic);

  // IKM = HKDF(auth secret, ECDH secret, "WebPush: info" || 0 || ua_public || as_public)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32));

  const salt = options.salt ?? randomBytes(16);
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12));

  // One record: the message, then the 0x02 delimiter that marks the last record.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([0x02])])), cipher.final(), cipher.getAuthTag()]);

  // Header: salt (16) · record size (4, big-endian) · key id length (1) · key id = sender public key (65).
  const header = Buffer.alloc(16 + 4 + 1);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, encrypted]);
}

/** A new VAPID key pair, base64url — for the server's settings, made once. */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pub = publicKey.export({ format: 'jwk' });
  const priv = privateKey.export({ format: 'jwk' });
  const point = Buffer.concat([Buffer.from([0x04]), fromB64u(pub.x as string), fromB64u(pub.y as string)]);
  return { publicKey: b64u(point), privateKey: priv.d as string };
}

/** The `Authorization` header for one push service (RFC 8292): a short-lived ES256 token naming us. */
export async function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): Promise<string> {
  const point = fromB64u(keys.publicKey);
  if (point.length !== 65) throw new Error('VAPID_PUBLIC_KEY is not a 65-byte P-256 point.');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64u(point.subarray(1, 33)),
    y: b64u(point.subarray(33, 65)),
    d: keys.privateKey,
  };
  const key = await importJWK(jwk, 'ES256');
  const audience = new URL(endpoint).origin;
  const token = await new SignJWT({})
    .setProtectedHeader({ typ: 'JWT', alg: 'ES256' })
    .setAudience(audience)
    .setSubject(keys.subject)
    .setExpirationTime(Math.floor(now / 1000) + 12 * 3600)
    .sign(key);
  return `vapid t=${token}, k=${keys.publicKey}`;
}

export type PushOutcome = { ok: true } | { ok: false; gone: boolean; status: number; message: string };

/**
 * Sends one message to one browser. `gone` means the browser has withdrawn —
 * the person turned notifications off or the browser was reset — and its
 * subscription should be forgotten rather than tried again.
 */
export async function sendPush(
  target: PushTarget,
  message: Record<string, unknown>,
  keys: VapidKeys,
  fetchImpl: typeof fetch = fetch,
): Promise<PushOutcome> {
  const body = encryptForBrowser(Buffer.from(JSON.stringify(message), 'utf8'), target);
  const response = await fetchImpl(target.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, keys),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // Kept a day: a phone switched off overnight still gets it in the morning.
      TTL: '86400',
      Urgency: 'normal',
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 200 && response.status < 300) return { ok: true };
  const text = await response.text().catch(() => '');
  return {
    ok: false,
    gone: response.status === 404 || response.status === 410,
    status: response.status,
    message: `${response.status} ${text.slice(0, 200)}`.trim(),
  };
}

/** The keys from the environment, or null when push is not set up. */
export function vapidFromEnv(env: NodeJS.ProcessEnv = process.env): VapidKeys | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT?.trim() || 'mailto:no-reply@nexraah.in' };
}
