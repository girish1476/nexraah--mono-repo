/**
 * Browser notifications — the switch for this one device.
 *
 * The server holds the key (`VAPID_PUBLIC_KEY`) and the list of devices; this
 * file asks the browser for permission, subscribes it under that key, and
 * hands the subscription to `save`. `public/push-sw.js` shows what arrives.
 *
 * The same file is in both apps (no shared package until a second runtime
 * needs one — see the README).
 */

/** What the switch shows. `unavailable` = the server has no push key yet. */
export type PushState = 'unsupported' | 'unavailable' | 'blocked' | 'off' | 'on';

export interface BrowserSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const WORKER = '/push-sw.js';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function keyBytes(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(current: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

async function existing(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function pushState(publicKey: string | null): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (!publicKey) return 'unavailable';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const subscription = await existing();
  return subscription && sameKey(subscription.options.applicationServerKey, publicKey) ? 'on' : 'off';
}

/** Asks, subscribes, and saves. Resolves to the state the switch should show. */
export async function turnOn(
  publicKey: string,
  save: (subscription: BrowserSubscription) => Promise<unknown>,
): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'blocked';
  if (permission !== 'granted') return 'off';
  const registration = await navigator.serviceWorker.register(WORKER);
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  // Made under an older server key — the push service would refuse our sends.
  if (subscription && !sameKey(subscription.options.applicationServerKey, publicKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey) as BufferSource,
  });
  const json = subscription.toJSON();
  await save({ endpoint: subscription.endpoint, keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } });
  return 'on';
}

/** Tells the server first, then the browser — so a failure leaves nothing half-done. */
export async function turnOff(forget: (endpoint: string) => Promise<unknown>): Promise<PushState> {
  const subscription = await existing();
  if (!subscription) return 'off';
  await forget(subscription.endpoint);
  await subscription.unsubscribe();
  return 'off';
}
