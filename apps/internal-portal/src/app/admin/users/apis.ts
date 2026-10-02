import { request } from '@/apis';
import { RoleCode } from '@/lib/permissions';

/** Allowed emails — `/admin/users` · `config.manage`. */
export interface AllowedEmail {
  id: string;
  email: string;
  name: string;
  /** A built-in role code, or the code of a custom role added from Access control. */
  role: RoleCode | (string & {});
  branch: { id: string; code: string; name: string } | null;
  status: 'ACTIVE' | 'DISABLED';
  /** The login exists, so a code can be sent. False only if the database trigger has not run. */
  canSignIn: boolean;
  createdAt: string;
}

/** GET /admin/users — everyone allowed to sign in, newest first. */
export function listAllowedEmails() {
  return request<AllowedEmail[]>({ url: '/admin/users', method: 'GET' });
}

/** POST /admin/users — allow an email, with the role it signs in as. 409 EMAIL_ALREADY_ALLOWED. */
export function allowEmail(draft: { email: string; role: string; name?: string; branchId?: string }) {
  return request<AllowedEmail>({ url: '/admin/users', method: 'POST', data: draft });
}

/** PATCH /admin/users/:id — role, branch, name, or switch access off/on. 409 SELF_LOCKOUT. */
export function updateAllowedEmail(
  id: string,
  patch: { role?: string; name?: string; branchId?: string | null; status?: 'ACTIVE' | 'DISABLED' },
) {
  return request<AllowedEmail>({ url: `/admin/users/${id}`, method: 'PATCH', data: patch });
}
