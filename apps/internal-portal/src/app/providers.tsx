'use client';

import { Provider, useAtom } from 'jotai';
import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sessionAtom, Session } from '@/store/atoms';
import { request, errorMessage } from '@/apis';
import { ensureFreshToken, isSignedIn, signOut } from '@/lib/auth';
import { Toast, ErrorState } from '@/lib/ui';
import { Shell } from './shell';

/** Screens that must render before a session exists, or without one at all. */
const PUBLIC_PATHS = ['/signin'];

function isPublic(pathname: string | null): boolean {
  return Boolean(pathname && (pathname.startsWith('/print') || PUBLIC_PATHS.includes(pathname)));
}

/**
 * `GET /auth/session` is the first call every page depends on: it carries the
 * role, the server-issued permission list and the branch a scoped user is
 * scoped to. Nothing renders behind the shell until it resolves.
 *
 * Loading and failure used to collapse into the same `session === null`
 * state, which is why a bad or expired token — or the API being briefly
 * unreachable — read as an infinite "Signing in…" with no way to tell it had
 * actually already failed. `sessionAtom` starts `undefined` (loading) and
 * only becomes `null` on a resolved failure, so this can show a real error
 * with a retry instead of quietly hanging forever.
 */
function SessionBootstrap({ children }: { children: ReactNode }) {
  const [session, setSession] = useAtom(sessionAtom);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isPublic(pathname)) return;
    let cancelled = false;
    setError(null);

    // No token at all (first visit, signed out, cleared storage) is the
    // common case, not a failure — send straight to the sign-in screen
    // instead of firing a request that can only 401 and land on the "could
    // not load this screen" error state. A token that's present but rejected
    // (expired past refresh, account disabled, key rotated) is the genuine
    // anomaly and still gets the error + retry below.
    if (!isSignedIn()) {
      setSession(null);
      router.replace('/signin');
      return;
    }

    // Renew a token that is about to age out *before* the first call of the
    // session rather than letting it 401 and lean on the retry in `apis.ts`.
    // A tab left open overnight is the ordinary case for this console.
    ensureFreshToken()
      .then(() => request<Session>({ url: '/auth/session', method: 'GET' }))
      .then((s) => {
        if (cancelled) return;
        setSession(s);
      })
      .catch((e) => {
        if (cancelled) return;
        setSession(null);
        // A refresh that could not save the session leaves nothing to retry
        // with — go to sign-in rather than showing a retry button that can
        // only fail the same way.
        if (!isSignedIn()) {
          router.replace('/signin');
          return;
        }
        setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
    // Re-runs on navigation, and when the retry button below bumps `attempt`.
  }, [pathname, router, setSession, attempt]);

  /**
   * `/` is a signpost, not a screen: which desk you land on depends on the
   * role, and the role is only known once the session above resolves.
   *
   * This is its own effect rather than a line inside that `.then` because a
   * `router.replace()` issued while the navigation *to* `/` is still in
   * flight gets swallowed, and the app then sits on `/` — signed in, shell
   * rendered, going nowhere. Sign-in makes that race easy to hit: it is one
   * navigation followed immediately by a session fetch. As an effect keyed on
   * the session, a redirect that does not take is simply reissued on the next
   * render instead of being lost.
   */
  useEffect(() => {
    if (!session || pathname !== '/') return;
    router.replace(session.role === 'ADMIN' ? '/admin' : sessionLanding(session));
  }, [session, pathname, router]);

  // The sign-in screen must never be gated behind the session it exists to
  // establish in the first place.
  if (isPublic(pathname)) return <>{children}</>;

  if (session === null) {
    return <SignInError message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  return <Shell session={session ?? null}>{children}</Shell>;
}

/**
 * A token is present but the server would not accept it, and a refresh could
 * not rescue it — a disabled account, a principal holding no internal role,
 * a rotated signing key, or internal-api being briefly unreachable.
 *
 * Retry is offered first because the last of those cases is transient and
 * common, and signing out to fix a network blip loses nothing but costs a
 * password. The paste-a-raw-JWT box this replaces existed only to work
 * around `?devToken=` links being truncated in chat apps; with a real sign-in
 * screen there is nothing left for a person to paste.
 */
function SignInError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const router = useRouter();

  // Discards the session on the way out, rather than linking to /signin —
  // that screen turns signed-in visitors around at the door, and a token
  // rejected by the server still counts as one, so a plain link would
  // bounce between the two forever.
  const startOver = () => {
    signOut();
    router.replace('/signin');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorState message={message ?? 'The session could not be verified.'} retry={onRetry} />
        <div className="surface" style={{ padding: 16, textAlign: 'center' }}>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>
            If this keeps happening, sign in again.
          </p>
          <button className="btn" onClick={startOver}>
            Go to sign in
          </button>
        </div>
      </div>
    </div>
  );
}

function sessionLanding(session: Session): string {
  const landing: Record<string, string> = {
    OPS: '/today',
    COMPLIANCE: '/compliance',
    FINANCE: '/payments/balance',
    LEADERSHIP: '/home',
    ADMIN: '/admin',
  };
  return landing[session.role] ?? '/today';
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <Provider>
      <SessionBootstrap>{children}</SessionBootstrap>
      <Toast />
    </Provider>
  );
}
