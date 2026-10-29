'use client';

import { useEffect, useState } from 'react';
import { errorMessage, request } from '@/apis';
import { pushState, turnOff, turnOn, type BrowserSubscription, type PushState } from '@/lib/push';
import { useToast } from '@/lib/ui';

/*
 * The bell in the user bar — browser notifications for this one computer or
 * phone: approvals waiting for you, and your own requests decided.
 *
 * Renders nothing when the browser cannot do it or the server has no push key
 * (`VAPID_PUBLIC_KEY`) — the demo never has one. The user bar is mounted twice
 * (desktop and phone), so the key is asked for once and shared.
 */

let keyRequest: Promise<string | null> | null = null;
function serverKey(): Promise<string | null> {
  keyRequest ??= request<{ publicKey: string | null }>({ url: '/notifications/push-key', method: 'GET' })
    .then((r) => r?.publicKey ?? null)
    .catch(() => {
      keyRequest = null;
      return null;
    });
  return keyRequest;
}

const save = (subscription: BrowserSubscription) =>
  request({ url: '/notifications/push-subscriptions', method: 'POST', data: subscription });
const forget = (endpoint: string) =>
  request({ url: '/notifications/push-subscriptions', method: 'DELETE', data: { endpoint } });

const TITLE: Record<PushState, string> = {
  on: 'Notifications are on for this browser — click to turn them off',
  off: 'Turn on notifications for this browser',
  blocked: 'This browser has blocked notifications from the console — allow them in its site settings',
  unsupported: '',
  unavailable: '',
};

export function PushSwitch() {
  const toast = useToast();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    serverKey().then(async (key) => {
      const now = await pushState(key);
      if (live) {
        setPublicKey(key);
        setState(now);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (!state || !publicKey || state === 'unsupported' || state === 'unavailable') return null;

  const flip = async () => {
    if (state === 'blocked') {
      toast(TITLE.blocked);
      return;
    }
    setBusy(true);
    try {
      if (state === 'on') {
        setState(await turnOff(forget));
        toast('Notifications turned off for this browser');
      } else {
        const next = await turnOn(publicKey, save);
        setState(next);
        toast(next === 'on' ? 'Notifications on · a test one is on its way' : 'Notifications were not allowed');
      }
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const on = state === 'on';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Browser notifications"
      title={TITLE[state]}
      className={on ? 'userbar-signout userbar-bell is-on' : 'userbar-signout userbar-bell'}
      disabled={busy}
      onClick={flip}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill={on ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        {state === 'blocked' && <path d="M3 3l18 18" />}
      </svg>
    </button>
  );
}
