import { SetMetadata } from '@nestjs/common';
import type { PermissionLevel } from '../interfaces/authenticated-user.interface';

export const REQUIRE_PERMISSION_KEY = 'requirePermission';

export interface RequiredPermission {
  code: string;
  level: PermissionLevel;
}

/**
 * `@UseGuards(SupabaseJwtGuard, PermissionsGuard) @RequirePermission('payment.release')`
 * — part 01 §2.5. An endpoint with no `@RequirePermission` is open to any
 * authenticated internal principal (`SupabaseJwtGuard` already rejected
 * anyone with no internal role); `GET /auth/session`, `GET /branches` and the
 * `GET` half of `/config` are exactly that case.
 *
 * `level` defaults to `EDIT` because every named permission this system seeds
 * (`payment.release`, `indent.create`, `document.verify`, …) is an action
 * gate, not a module View/Edit pair — pass `'VIEW'` explicitly for a
 * read-only check.
 */
export const RequirePermission = (code: string, level: PermissionLevel = 'EDIT') =>
  SetMetadata(REQUIRE_PERMISSION_KEY, { code, level } satisfies RequiredPermission);
