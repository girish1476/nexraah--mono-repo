import { SetMetadata } from '@nestjs/common';

export const PORTAL_ROUTE_KEY = 'portalRoute';

/**
 * Marks a controller (or one handler) as part of the transporter surface,
 * `/api/v1/portal/*`. Two guards read it and they lock in opposite
 * directions — `ADR-02` §4, `docs/api/11-portal.md` §1:
 *
 * - `PortalServiceGuard`, applied to the marked controllers, refuses a
 *   request that did NOT arrive through the vendor edge (`403
 *   SERVICE_KEY_REQUIRED`).
 * - `PortalAudienceGuard`, global, refuses a request that DID carry the edge
 *   key at any route that is not marked (`403 WRONG_AUDIENCE`).
 *
 * Metadata rather than a `req.url.startsWith('/api/v1/portal')` string test:
 * a path prefix is one careless `@Controller('portal-ish')` away from being
 * wrong in the direction that opens the door, and the global prefix is set in
 * `main.ts` rather than known here.
 */
export const PortalRoute = () => SetMetadata(PORTAL_ROUTE_KEY, true);
