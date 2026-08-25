import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { DomainException } from '../domain-exception';
import { validateEnv } from '../../config/env';

/**
 * `ADR-02` §4 / `docs/api/11-portal.md` §1: two credentials answer two
 * questions. `Authorization: Bearer` answers *who is this* (handled by
 * `PortalVendorGuard`); `X-Portal-Service` answers *did this arrive through
 * the vendor edge*, and that is all it answers. It is not a JWT, carries no
 * claims, and NEVER names a vendor — a proxy that could name the vendor would
 * be a proxy that could impersonate one.
 *
 * Applied to every `/portal/*` controller. Its mirror image,
 * `PortalAudienceGuard`, is global and refuses this same header everywhere
 * else.
 */
@Injectable()
export class PortalServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const presented = request.headers['x-portal-service'];
    const expected = validateEnv(process.env as Record<string, unknown>).PORTAL_SERVICE_KEY;

    if (typeof presented !== 'string' || !constantTimeEqual(presented, expected)) {
      throw new DomainException(
        403,
        'SERVICE_KEY_REQUIRED',
        'This endpoint is reachable only through the transporter portal.',
      );
    }
    return true;
  }
}

/**
 * `timingSafeEqual` throws on a length mismatch, and a length mismatch is
 * itself an answer — so the lengths are compared first and the comparison
 * still runs, against a fixed-length digest-shaped pair, when they differ.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length === 0 || bufB.length === 0) return false;
  if (bufA.length !== bufB.length) {
    // Burn a comparable amount of time, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
