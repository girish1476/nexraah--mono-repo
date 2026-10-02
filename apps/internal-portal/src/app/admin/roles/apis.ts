import { request } from '@/apis';
import { Level, Permission, RoleCode } from '@/lib/permissions';
import { RoleMatrixResponse } from './types';

/** GET /admin/roles → the matrix as the server holds it. */
export function getRoleMatrix() {
  return request<RoleMatrixResponse>({ url: '/admin/roles', method: 'GET' });
}

/**
 * PATCH /admin/roles/:role/permissions  { permission, level }
 *
 * `role` is a built-in role code or a custom role's code.
 *
 * 409 PERMISSION_FIXED when the grant is refused — `payment.release` to a
 * second role (BR-40), `pod.waive` off compliance/leadership (BR-43),
 * `rfq.submit` off leadership, `config.manage` off admin.
 * Every accepted change writes a PERMISSION audit row (NFR-03).
 */
export function setPermission(role: string, permission: Permission, level: Level) {
  return request<unknown>({
    url: `/admin/roles/${role}/permissions`,
    method: 'PATCH',
    data: { permission, level },
  });
}

/**
 * POST /admin/roles  { name, basedOn } → the matrix, with the new role in it.
 *
 * The role opens `basedOn`'s screens and starts with its permissions, minus
 * the fixed ones. 409 ROLE_EXISTS when the name is taken.
 */
export function createRole(draft: { name: string; basedOn: RoleCode }) {
  return request<RoleMatrixResponse>({ url: '/admin/roles', method: 'POST', data: draft });
}

/** DELETE /admin/roles/:role — custom roles only. 409 ROLE_IN_USE while anyone signs in with it. */
export function deleteRole(role: string) {
  return request<RoleMatrixResponse>({ url: `/admin/roles/${role}`, method: 'DELETE' });
}
