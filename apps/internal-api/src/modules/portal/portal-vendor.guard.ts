import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { errors as joseErrors } from 'jose';
import { validateEnv } from '../../config/env';
import { verifySupabaseJwt } from '../../lib/jwks';
import { DomainException } from '../../common/domain-exception';
import { PortalIdentityRepository } from './portal-identity.repository';
import { PORTAL_PERMISSIONS, PORTAL_READABLE_VENDOR_STATUSES } from './portal.constants';
import type { PortalVendor } from './portal.types';

/**
 * The second of `ADR-02` §4's two credentials — *who is this*. `PortalServiceGuard`
 * has already answered *did this arrive through the vendor edge*; this one verifies
 * the bearer token and resolves it to a transporter principal.
 *
 * Deliberately NOT `SupabaseJwtGuard`: that one resolves the subject against
 * `users` and raises `403 WRONG_AUDIENCE` for anyone who is not an internal
 * principal — which every transporter is. Same token issuer, two different
 * principal tables, and collapsing them is how a transporter ends up holding a
 * console role.
 *
 * `vendorId` comes from `vendor_users`, never from a header (`11-portal.md` §1):
 * a proxy that could name the vendor could impersonate one.
 */
@Injectable()
export class PortalVendorGuard implements CanActivate {
  constructor(private readonly identity: PortalIdentityRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const env = validateEnv(process.env as Record<string, unknown>);

    let sub: string;
    try {
      const claims = await verifySupabaseJwt(this.extractToken(request), env);
      sub = claims.sub;
    } catch (error) {
      if (error instanceof joseErrors.JOSEError) {
        throw new DomainException(401, 'UNAUTHORIZED', 'Please sign in again.');
      }
      throw error;
    }

    const row = await this.identity.findVendorByAuthUserId(sub);

    // A token that verifies but names no transporter is 401, not 403 or 404:
    // it is a credential problem, and the screen's answer is "sign in again".
    // An internal user's token lands here too — they hold no `vendor_users`
    // row, and telling them so would name a table they cannot reach anyway.
    if (!row) {
      throw new DomainException(401, 'UNAUTHORIZED', 'Please sign in again.');
    }

    // BLACKLISTED / anything outside the two live statuses loses the session
    // entirely. `SUSPENDED` is in the list on purpose — `vendor-specs/01-P1`
    // §2.3: reads allowed, writes refused, and the refusal belongs on the
    // write path, not here.
    if (!(PORTAL_READABLE_VENDOR_STATUSES as readonly string[]).includes(row.status)) {
      throw new DomainException(401, 'UNAUTHORIZED', 'Please sign in again.');
    }

    const vendor: PortalVendor = {
      vendorId: row.vendorId,
      authUserId: row.authUserId,
      code: row.code,
      legalName: row.legalName,
      status: row.status,
      // `20260814090400` §1 keeps the portal codes out of `role_permissions`
      // on purpose — the portal surface authorises via `vendor_users` plus the
      // service key, so this is a fixed set rather than a query.
      permissions: PORTAL_PERMISSIONS,
    };

    request.portalVendor = vendor;
    return true;
  }

  private extractToken(request: Request): string {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new DomainException(401, 'UNAUTHORIZED', 'Please sign in again.');
    }
    return header.slice('Bearer '.length);
  }
}
