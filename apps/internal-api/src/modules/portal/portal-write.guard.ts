import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { portalError } from './portal.errors';
import { PORTAL_READ_ONLY_KEY, REQUIRE_PORTAL_PERMISSION_KEY } from './portal.decorators';

/**
 * The write half of the transporter's authorisation, and the only place
 * `vendor-specs/01-P1` §2.3 is enforced:
 *
 * > `VENDOR_SUSPENDED` | 403 | Reads allowed, writes refused
 *
 * `PortalVendorGuard` deliberately lets a `SUSPENDED` vendor keep its session —
 * the suspension banner needs `GET /portal/me` to answer — so the refusal has
 * to live on the write path, which is this guard.
 *
 * Every non-`GET` portal handler counts as a write. `@PortalReadOnly()` marks
 * the exceptions (there are none today; the marker exists so that adding one is
 * a decision rather than an accident).
 *
 * It also reads `@RequirePortalPermission()`: `11-portal.md` §5 says
 * "permission is `portal.self` unless named otherwise", so an unmarked handler
 * is checked against `portal.self` rather than waved through — an unmarked
 * handler being the one most likely to be a mistake.
 *
 * A missing permission is `NOT_FOUND`, not `403`: §2's "404, never 403" is
 * about not confirming that a thing exists, and a 403 here confirms the route
 * does.
 */
@Injectable()
export class PortalWriteGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const vendor = request.portalVendor;

    // PortalVendorGuard runs first and throws when the token names no
    // transporter, so this is a wiring error rather than a request problem.
    if (!vendor) throw portalError('UNAUTHORIZED');

    const required =
      this.reflector.getAllAndOverride<string | undefined>(REQUIRE_PORTAL_PERMISSION_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'portal.self';

    if (!vendor.permissions.includes(required)) {
      throw portalError('NOT_FOUND');
    }

    const readOnly = this.reflector.getAllAndOverride<boolean | undefined>(PORTAL_READ_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isWrite = request.method !== 'GET' && request.method !== 'HEAD' && !readOnly;
    if (isWrite && vendor.status !== 'ACTIVE') {
      throw portalError('VENDOR_SUSPENDED');
    }

    return true;
  }
}
