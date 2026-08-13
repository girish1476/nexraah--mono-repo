'use client';

import { Provider, useAtom } from 'jotai';
import { ReactNode, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { sessionAtom, Session } from '@/store/atoms';
import { request } from '@/apis';
import { Toast } from '@/lib/ui';
import { Shell } from './shell';

/**
 * `GET /auth/session` is the first call every page depends on: it carries the
 * role, the server-issued permission list and the branch a BRANCH_MGR is
 * scoped to. Nothing renders behind the shell until it resolves.
 */
function SessionBootstrap({ children }: { children: ReactNode }) {
  const [session, setSession] = useAtom(sessionAtom);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    request<Session>({ url: '/auth/session', method: 'GET' })
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        if (pathname === '/') router.replace(s.role === 'ADMIN' ? '/admin' : sessionLanding(s));
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      });
    return () => {
      cancelled = true;
    };
    // Re-runs when the prototype role switcher writes localStorage and reloads.
  }, [pathname, router, setSession]);

  if (pathname?.startsWith('/print')) return <>{children}</>;
  return <Shell session={session}>{children}</Shell>;
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
