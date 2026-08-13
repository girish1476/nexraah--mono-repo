'use client';

import Link from 'next/link';
import { useAtomValue } from 'jotai';
import { sessionAtom } from '@/store/atoms';
import { ROLES } from '@/lib/permissions';
import { Loading } from '@/lib/ui';

/**
 * Every role lands somewhere it can act. `providers.tsx` redirects on session
 * load; this page is what shows while that resolves, and the fallback if it
 * does not.
 */
export default function IndexPage() {
  const session = useAtomValue(sessionAtom);

  if (!session) return <Loading what="Signing in" />;

  return (
    <div>
      <h1>Nexraah internal console</h1>
      <p className="muted">
        Signed in as {session.name} · {ROLES[session.role].label}
      </p>
      <p>
        <Link href={ROLES[session.role].landsOn}>Go to {ROLES[session.role].landsOn}</Link>
      </p>
    </div>
  );
}
