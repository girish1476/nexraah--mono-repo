import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { encryptForBrowser, generateVapidKeys, MAX_PAYLOAD_BYTES, sendPush, vapidAuthorization } from './web-push';

/**
 * Browser push without a library. These play the browser's side — make a key
 * pair and an auth secret, decrypt what arrives — and check the push service's
 * side, the signed VAPID header. (Checked as well, outside this suite, against
 * `http_ece`, the decryptor the `web-push` package itself is tested with.)
 */

function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, target: { endpoint: 'https://push.example/send/abc', p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

/** What a browser does with a message: RFC 8291 / RFC 8188, from the receiving end. */
function decrypt(body: Buffer, ecdh: ReturnType<typeof createECDH>, auth: Buffer): Buffer {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body.readUInt8(20);
  const senderPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  expect(recordSize).toBe(4096);
  const ecdhSecret = ecdh.computeSecret(senderPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), senderPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, auth, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(padded[padded.length - 1]).toBe(0x02);
  return padded.subarray(0, padded.length - 1);
}

describe('encrypting a message for one browser', () => {
  it('only that browser can read it', () => {
    const b = browser();
    const message = Buffer.from(JSON.stringify({ title: 'Load 4471 awarded to you', body: 'Bengaluru → Chennai at ₹30,500' }));
    const body = encryptForBrowser(message, b.target);
    expect(decrypt(body, b.ecdh, b.auth).toString()).toBe(message.toString());

    const other = browser();
    expect(() => decrypt(body, other.ecdh, other.auth)).toThrow();
  });

  it('each message is encrypted afresh', () => {
    const b = browser();
    const m = Buffer.from('same words');
    expect(encryptForBrowser(m, b.target).equals(encryptForBrowser(m, b.target))).toBe(false);
  });

  it('refuses a message too long for one record, and a key that is not a browser key', () => {
    const b = browser();
    expect(() => encryptForBrowser(Buffer.alloc(MAX_PAYLOAD_BYTES + 1), b.target)).toThrow(/at most/);
    expect(() => encryptForBrowser(Buffer.from('x'), { p256dh: 'AAAA', auth: b.target.auth })).toThrow(/P-256/);
  });
});

describe('saying who sent it', () => {
  it('is an ES256 token for the push service’s own origin, verifiable with our public key', async () => {
    const keys = { ...generateVapidKeys(), subject: 'mailto:ops@nexusfreight.in' };
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/xyz', keys, Date.parse('2026-10-29T10:00:00Z'));
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(keys.publicKey);
    expect(decodeProtectedHeader(token).alg).toBe('ES256');
    const point = Buffer.from(keys.publicKey, 'base64url');
    const publicJwk = { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') };
    const { payload } = await jwtVerify(token, await importJWK(publicJwk, 'ES256'), {
      audience: 'https://fcm.googleapis.com',
      currentDate: new Date('2026-10-29T10:00:00Z'),
    });
    expect(payload.sub).toBe('mailto:ops@nexusfreight.in');
    expect(payload.exp).toBe(Math.floor(Date.parse('2026-10-29T10:00:00Z') / 1000) + 12 * 3600);
  });
});

describe('sending', () => {
  const keys = { ...generateVapidKeys(), subject: 'mailto:ops@nexusfreight.in' };

  it('posts the encrypted message with the headers a push service needs', async () => {
    const b = browser();
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    expect(await sendPush(b.target, { title: 'Hello' }, keys, fetchImpl as never)).toEqual({ ok: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string>; body: Uint8Array }];
    expect(url).toBe(b.target.endpoint);
    expect(init.headers['Content-Encoding']).toBe('aes128gcm');
    expect(init.headers.TTL).toBe('86400');
    expect(init.headers.Authorization).toMatch(/^vapid t=/);
    expect(JSON.parse(decrypt(Buffer.from(init.body), b.ecdh, b.auth).toString())).toEqual({ title: 'Hello' });
  });

  it('a browser that has gone away is told apart from a failure worth retrying', async () => {
    const b = browser();
    const gone = await sendPush(b.target, {}, keys, (async () => new Response('', { status: 410 })) as never);
    expect(gone).toMatchObject({ ok: false, gone: true, status: 410 });
    const busy = await sendPush(b.target, {}, keys, (async () => new Response('slow down', { status: 429 })) as never);
    expect(busy).toMatchObject({ ok: false, gone: false, status: 429 });
  });
});
