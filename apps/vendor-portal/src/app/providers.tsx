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
 * Rendering is held back until the check has run. The alternative is a flash of
 * a transporter's loads before the redirect, which on a shared phone is a small
 * leak rather than a cosmetic flicker.
 */
function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const [checked, setChecked] = useState(false);

  const isPublic = PUBLIC_ROUTES.some((r) => pathname.startsWith(r));

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (isPublic) {
        if (!cancelled) setChecked(true);
        return;
      }
      // Refresh a token that is about to die *before* the first screen fires
      // its requests, so a driver who left the app open overnight does not get
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
  }, [isPublic, pathname, router]);

  if (!checked) return null;
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Provider>
      <AuthGate>{children}</AuthGate>
    </Provider>
  );
}
