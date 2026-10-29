// Makes the key pair for browser notifications (VAPID, RFC 8292) — free, no account anywhere.
//
//   node supabase/scripts/push-keys.mjs
//
// Put both lines in Render → nexraah-internal-api → Environment, once. Keep the
// private key out of chat and out of git. Changing the pair later means every
// browser has to turn notifications on again, so make it once and keep it.
// Same format as `generateVapidKeys()` in apps/internal-api/src/modules/notifications/web-push.ts.
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pub = publicKey.export({ format: 'jwk' });
const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);

console.log(`VAPID_PUBLIC_KEY=${point.toString('base64url')}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey.export({ format: 'jwk' }).d}`);
