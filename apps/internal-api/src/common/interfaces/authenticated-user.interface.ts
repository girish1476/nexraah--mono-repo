export type InternalRole = 'OPS' | 'COMPLIANCE' | 'FINANCE' | 'BRANCH_MGR' | 'LEADERSHIP' | 'ADMIN';

export type PermissionLevel = 'NONE' | 'VIEW' | 'EDIT';

/**
 * Attached to `req.user` by `SupabaseJwtGuard`. `permissions` maps permission
 * code → the resolved level (seed grant composed with any roles-matrix
 * override — part 01 §2.4, `docs/api/01-foundation.md` `GET /admin/roles`).
 * Roles and permissions always come from our tables, never from a JWT claim
 * (part 14 §4.1) — a permission in a token is one that survives its own
 * revocation until the token expires.
 */
export interface AuthenticatedUser {
  userId: string;
  authUserId: string;
  name: string;
  email: string;
  role: InternalRole;
  branch: { id: string; code: string; name: string } | null;
  permissions: Map<string, PermissionLevel>;
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
  }
}
