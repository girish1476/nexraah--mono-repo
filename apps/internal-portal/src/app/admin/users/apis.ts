import { request } from '@/apis';
import { peopleStoreEnabled } from '@/lib/auth';
import { RoleCode } from '@/lib/permissions';
import { MOCKS_ENABLED, mockAdoptPeople } from '@/mocks';

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

/* ---- the server's copy -----------------------------------------------------
   With emailed sign-in codes on, the server decides who gets a code. The list
   on this screen is kept in step with the server's (app/api/people), so a
   person added here can sign in from any phone or computer, and every
   administrator sees the same people. Without it (the demo, or a deployment
   with no shared list set up) none of this runs and the list stays in this
   browser, as before. */

async function people(method: 'GET' | 'PUT', body?: Record<string, unknown>) {
  const response = await fetch('/api/people', {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; people?: Parameters<typeof mockAdoptPeople>[0] };
  if (!response.ok) throw new Error(payload.error ?? 'The change could not be saved for sign-in. Try again.');
  return payload;
}

async function shared(): Promise<boolean> {
  return MOCKS_ENABLED && (await peopleStoreEnabled());
}

/** Saves one row to the server's list. The row is already changed here; a refusal says so plainly. */
async function saveForSignIn(row: AllowedEmail): Promise<void> {
  if (!(await shared())) return;
  try {
    await people('PUT', {
      email: row.email,
      role: row.role,
      name: row.name,
      branch: row.branch?.code ?? null,
      disabled: row.status === 'DISABLED',
    });
  } catch (e) {
    throw new Error(`Changed on this screen only — not saved for sign-in. ${(e as Error).message}`);
  }
}

/** GET /admin/users — everyone allowed to sign in, newest first. */
export async function listAllowedEmails() {
  if (await shared()) {
    // A server list that cannot be read must not hide the screen: show this browser's copy.
    await people('GET')
      .then((p) => mockAdoptPeople(p.people ?? []))
      .catch(() => undefined);
  }
  return request<AllowedEmail[]>({ url: '/admin/users', method: 'GET' });
}

/** POST /admin/users — allow an email, with the role it signs in as. 409 EMAIL_ALREADY_ALLOWED. */
export async function allowEmail(draft: { email: string; role: string; name?: string; branchId?: string }) {
  const added = await request<AllowedEmail>({ url: '/admin/users', method: 'POST', data: draft });
  await saveForSignIn(added);
  return added;
}

/** PATCH /admin/users/:id — role, branch, name, or switch access off/on. 409 SELF_LOCKOUT. */
export async function updateAllowedEmail(
  id: string,
  patch: { role?: string; name?: string; branchId?: string | null; status?: 'ACTIVE' | 'DISABLED' },
) {
  const updated = await request<AllowedEmail>({ url: `/admin/users/${id}`, method: 'PATCH', data: patch });
  await saveForSignIn(updated);
  return updated;
}
