'use client';

import type { ReactNode } from 'react';
import { ModuleGuard } from '@/lib/ui';

/**
 * Every page under /hr sits behind the guard here, so nothing below asks the
 * server for anything until the role is known to have access. A page-level
 * guard alone was too late: the page's own request was refused first and its
 * error showed instead of the redirect.
 */
export default function Layout({ children }: { children: ReactNode }) {
  return <ModuleGuard module="hr">{children}</ModuleGuard>;
}
