import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { PortalVendor } from './portal.types';

/** `@CurrentVendor() vendor: PortalVendor` — set by `PortalVendorGuard`. */
export const CurrentVendor = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalVendor => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // PortalVendorGuard runs before every handler that uses this and throws
    // if the JWT resolves to no vendor, so this is never undefined in a
    // handler body.
    return request.portalVendor as PortalVendor;
  },
);

/**
 * `X-Request-Id`, as `RequestIdMiddleware` resolved it — the header when the
 * vendor edge sent one, a fresh uuid when it did not. Portal writes carry it
 * into `audit_events.request_id` (`ADR-02` §7), which is how a transporter's
 * screenshot is tied to the row it created.
 *
 * Reads `req.requestId` rather than the raw header so that the value logged,
 * the value returned on the response, and the value audited are the same one.
 */
export const CurrentRequestId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<Request & { requestId?: string }>();
    return request.requestId;
  },
);

export const REQUIRE_PORTAL_PERMISSION_KEY = 'requirePortalPermission';

/**
 * `11-portal.md` §5: "Permission is `portal.self` unless named otherwise" —
 * `POST /portal/trips/:id/pod` is `pod.upload` and
 * `POST /portal/trips/:id/bill` is `portal.bill`.
 *
 * Deliberately NOT `@RequirePermission` from `common/decorators`: that one is
 * read by `PermissionsGuard` against `AuthenticatedUser.permissions`, which a
 * transporter does not have and must never be given. Two audiences, two
 * decorators, two guards — collapsing them is how a transporter ends up
 * holding `pod.verify` because both sides happened to use one map.
 */
export const RequirePortalPermission = (code: string) =>
  SetMetadata(REQUIRE_PORTAL_PERMISSION_KEY, code);

export const PORTAL_READ_ONLY_KEY = 'portalReadOnly';

/**
 * `11-portal.md` §2 / `vendor-specs/01-P1` §2.3: a suspended vendor gets
 * `403 VENDOR_SUSPENDED` on writes and normal service on reads. Every
 * non-`GET` portal handler is a write by default; this marks the exceptions
 * (there are none today, and the marker exists so that adding one is a
 * decision rather than an accident).
 */
export const PortalReadOnly = () => SetMetadata(PORTAL_READ_ONLY_KEY, true);
