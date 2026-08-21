'use client';

import { Provider, useAtom } from 'jotai';
import { ReactNode, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sessionAtom, Session } from '@/store/atoms';
import { request, errorMessage } from '@/apis';
import { Toast, ErrorState, Field } from '@/lib/ui';
import { Shell } from './shell';

/**
 * Prototype-only, same footing as the `X-Debug-Role` switcher this app
 * already ships (`shell.tsx`) — there is no Supabase Auth login screen yet,
 * so `apis.ts` just reads `localStorage.token`. Getting that token into
 * localStorage by hand (open devtools, paste, reload) is easy to get subtly
 * wrong with no feedback — a stray space, the wrong tab's origin, a paste
 * that silently didn't take. `?devToken=…` sets it from a single link
 * instead: read once on mount, stored, then stripped from the URL so it
 * doesn't linger in browser history. Delete this whole block along with the
 * role switcher when real Supabase Auth lands.
 */
function useDevTokenFromUrl() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const devToken = url.searchParams.get('devToken');
    if (!devToken) return;
    localStorage.setItem('token', devToken);
    url.searchParams.delete('devToken');
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, []);
}

/**
 * `GET /auth/session` is the first call every page depends on: it carries the
 * role, the server-issued permission list and the branch a BRANCH_MGR is
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

  useDevTokenFromUrl();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    request<Session>({ url: '/auth/session', method: 'GET' })
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        if (pathname === '/') router.replace(s.role === 'ADMIN' ? '/admin' : sessionLanding(s));
      })
      .catch((e) => {
        if (cancelled) return;
        setSession(null);
        setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
    // Re-runs when the prototype role switcher writes localStorage and reloads,
    // or when the retry button below bumps `attempt`.
  }, [pathname, router, setSession, attempt]);

  // /dev-login has its own tokens and does its own redirect — it must never
  // be gated behind the session it exists to establish in the first place.
  if (pathname?.startsWith('/print') || pathname === '/dev-login') return <>{children}</>;

  if (session === null) {
    return <SignInError message={error} onRetry={() => setAttempt((n) => n + 1)} />;
  }

  return <Shell session={session ?? null}>{children}</Shell>;
}

/**
 * The `?devToken=` link (above) is a full JWT in the URL — several hundred
 * characters, and a link that long silently truncates or gets stripped by
 * some chat apps and link previewers before it ever reaches the browser.
 * When that happens the visible symptom is identical to a real auth
 * failure ("Missing bearer token"), so this paste box is the fallback: copy
 * just the raw token — not a whole URL — into a plain field. Nothing about
 * copying a short-ish string into an input has the same failure mode.
 */
function SignInError({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  const [pasted, setPasted] = useState('');

  const signIn = () => {
    const token = pasted.trim();
    if (!token) return;
    localStorage.setItem('token', token);
    onRetry();
  };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div style={{ maxWidth: 420, width: '100%', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <ErrorState message={message ?? 'The session could not be verified.'} retry={onRetry} />
        <div className="surface" style={{ padding: 16, textAlign: 'center' }}>
          <a href="/dev-login" className="btn" style={{ display: 'inline-block' }}>
            Go to sign in
          </a>
        </div>
        <div className="surface" style={{ padding: 16 }}>
          <Field
            label="Or paste a sign-in token directly"
            hint="Prototype only — this stands in for real sign-in until Supabase Auth lands."
          >
            <textarea
              rows={3}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder="eyJhbGciOi…"
              style={{ fontFamily: 'monospace', fontSize: 11.5, resize: 'vertical' }}
            />
          </Field>
          <button className="btn" style={{ marginTop: 10 }} onClick={signIn} disabled={!pasted.trim()}>
            Sign in
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
    BRANCH_MGR: '/today',
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
