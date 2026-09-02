'use client';

import { Provider } from 'jotai';
import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { ensureFreshToken, isSignedIn } from '@/lib/auth';

/**
 * Routes reachable without a token. Everything else in this app is one
 * transporter's own money and paperwork, so the list is short and explicit —
 * a new screen is private unless someone deliberately adds it here.
 */
const PUBLIC_ROUTES = ['/signin'];

/**
 * Keeps a signed-out person out of screens that only make sense signed in.
 *
 * `apis.ts` already sends a 401 to `/signin`, and that remains the backstop for
 * a session that expires mid-use. This is the other half: against the fixture
 * adapter **nothing ever returns 401**, so without this check the demo would
 * have a front door that nobody is ever made to walk through — and against the
 * real API a signed-out visitor would watch several screens fail one request at
 * a time instead of being told once, plainly, that they need to sign in.
 *
 * **The gate runs once, on mount, and never again.** That is load-bearing, not
 * an optimisation. An earlier version depended on `usePathname()` and re-ran on
 * every navigation, which broke client-side navigation across the whole app:
 * `<Link>` intercepts the click and starts a transition, this component then
 * re-rendered mid-transition, and the navigation was abandoned with the URL
 * left where it started. Every committed test that clicked a link to move
 * between screens failed, and the symptom — a click that registers and does
 * nothing — looks nothing like its cause.
 *
 * Reading the token once is also the honest scope: a token cannot appear or
 * vanish because someone moved between screens, only because they signed in,
 * signed out, or the server rejected it. Sign-in and sign-out both do a hard
 * `location.replace`, so this remounts and re-checks; rejection is `apis.ts`'s
 * 401 path. No route change needs to re-ask.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Read at mount rather than from a hook, so this effect can have an
      // empty dependency list and never re-run on navigation.
      const path = window.location.pathname;
      if (PUBLIC_ROUTES.some((r) => path.startsWith(r))) {
        if (!cancelled) setChecked(true);
        return;
      }

      // Refresh a token that is about to die *before* the first screen fires
      // its requests, so a driver who left the app open overnight is not
      // bounced to sign-in for a session that could have been renewed.
      await ensureFreshToken();
      if (cancelled) return;

      if (!isSignedIn()) {
        router.replace('/signin');
        return;
      }
      setChecked(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The sign-in screen must render even while `checked` is false — it is the
  // one place a signed-out person is supposed to be, and gating it behind its
  // own check would leave them staring at a blank page.
  if (!checked && !PUBLIC_ROUTES.some((r) => pathname.startsWith(r))) return null;
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Provider>
      <AuthGate>{children}</AuthGate>
    </Provider>
  );
}
