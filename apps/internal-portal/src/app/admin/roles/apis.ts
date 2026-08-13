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
 * 409 PERMISSION_FIXED when the grant is refused — `payment.release` to a
 * second role (BR-40), `pod.waive` off compliance/leadership (BR-43),
 * `rfq.submit` off leadership, `config.manage` off admin.
 * Every accepted change writes a PERMISSION audit row (NFR-03).
 */
export function setPermission(role: RoleCode, permission: Permission, level: Level) {
  return request<{ role: RoleCode; permission: Permission; level: Level }>({
    url: `/admin/roles/${role}/permissions`,
    method: 'PATCH',
    data: { permission, level },
  });
}
