import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

export interface SessionResponse {
  userId: string;
  name: string;
  email: string;
  role: string;
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
   * `branch` is `{id, code, name}` for `BRANCH_MGR` and `null` for every
   * other role, even when the `users` row carries a `branch_id` (seed data
   * sets one on every internal user, ADMIN included) — it is presentation
   * only, and every other role reads it as "not branch-scoped".
   */
  toSession(user: AuthenticatedUser): SessionResponse {
    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: [...user.permissions.entries()]
        .filter(([, level]) => level !== 'NONE')
        .map(([code]) => code),
      branch: user.role === 'BRANCH_MGR' ? user.branch : null,
    };
  }
}
