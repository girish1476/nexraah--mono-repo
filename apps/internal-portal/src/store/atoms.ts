import { atom } from 'jotai';
import { Permission, RoleCode, SEED_GRANTS } from '@/lib/permissions';

/**
 * Cross-page state. Page-local state stays inside the page folder.
 *
 * The session is authoritative on the server; what is held here drives
 * presentation only (NFR-01).
 */

export interface Branch {
  id: string;
  code: string;
  name: string;
}

export interface Session {
  userId: string;
  name: string;
  email: string;
  role: RoleCode;
  /** Server-issued list. Falls back to SEED_GRANTS before the call resolves. */
  permissions: Permission[];
  /** BRANCH_MGR only — every list is scoped to it at the repository layer. */
  branch: Branch | null;
}

/**
 * Three states, not two: `undefined` (the initial value) means `GET
 * /auth/session` hasn't resolved yet; `null` means it resolved to a failure.
 * Collapsing those into a single `null` is what let the sidebar sit on
 * "Signing in…" forever with no way to tell "still loading" from "the call
 * failed and nothing will change until something does" — the failure case
 * needs its own UI (SessionBootstrap), not the loading copy.
 */
export const sessionAtom = atom<Session | null | undefined>(undefined);

export const roleAtom = atom<RoleCode>((get) => get(sessionAtom)?.role ?? 'OPS');

export const permissionsAtom = atom<Permission[]>((get) => {
  const session = get(sessionAtom);
  if (!session) return [];
  return session.permissions?.length ? session.permissions : SEED_GRANTS[session.role];
});

export const isAuthenticatedAtom = atom((get) => Boolean(get(sessionAtom)));

/** Single transient toast. Written by `useToast()`. */
export const toastAtom = atom<string>('');

/** Approval banner raised by the last 202 on this screen (part 01 §3). */
export interface ApprovalNotice {
  kind: string;
  entityId: string;
  approverRole: string;
}

export const approvalNoticeAtom = atom<ApprovalNotice | null>(null);
