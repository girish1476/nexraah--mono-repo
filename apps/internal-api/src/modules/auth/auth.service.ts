import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

export interface SessionResponse {
  userId: string;
  name: string;
  email: string;
  role: string;
  /** The custom role's own name; `null` for a built-in role. */
  roleLabel: string | null;
  /** The custom role's code; `null` for a built-in role. */
  customRole: string | null;
  permissions: string[];
  branch: { id: string; code: string; name: string } | null;
}

@Injectable()
export class AuthService {
  /**
   * `docs/api/01-foundation.md` `GET /auth/session`. `permissions` is the
   * authoritative grant list the frontend hides controls from — every code
   * held at `VIEW` or `EDIT`, `NONE` omitted.
   *
   * `branch` is passed through exactly as the `users` row carries it. It is
   * the single thing that decides whether a person is branch-scoped, now that
   * BRANCH_MGR is gone and Operations has absorbed it: a user with a branch
   * sees only that branch, a user without one sees the whole company.
   *
   * This used to be nulled for every role except BRANCH_MGR, which made the
   * column inert for everyone else. It is live for everyone now, so seed data
   * only sets a branch on people who are genuinely scoped to one — see
   * `supabase/seed.sql`. Adding a branch to a user is what scopes them; there
   * is no longer a role that does it.
   */
  toSession(user: AuthenticatedUser): SessionResponse {
    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      // A custom role reports the built-in role it is based on, because that
      // is what the portal lays its screens out by; its own name travels in
      // `roleLabel`. What it may do is `permissions`, which are its own.
      role: user.customRole?.basedOn ?? user.role,
      roleLabel: user.customRole?.name ?? null,
      customRole: user.customRole ? user.role : null,
      permissions: [...user.permissions.entries()]
        .filter(([, level]) => level !== 'NONE')
        .map(([code]) => code),
      branch: user.branch,
    };
  }
}
