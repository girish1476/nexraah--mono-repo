import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainException } from '../domain-exception';
import { PORTAL_ROUTE_KEY } from '../decorators/portal-route.decorator';

/**
 * The other half of `ADR-02` §4's two-way lock, registered globally in
 * `app.module.ts`:
 *
 *   /api/v1/portal/*  without a service key → 403 SERVICE_KEY_REQUIRED  (PortalServiceGuard)
 *   any other route   WITH a service key    → 403 WRONG_AUDIENCE        (this guard)
 *
 * Under `ADR-01` the second rule was free — internal controllers were not
 * loaded in the vendor process at all. `ADR-02` §8 is explicit that the
 * guarantee is now "a property of `internal-api`'s module wiring rather than
 * of the operating system's process boundary, and it is weaker for that".
 * This guard is that property. Without it, one careless proxy rule in
 * `vendor-api` makes `/api/v1/pnl` internet-reachable.
 *
 * Deliberately runs before `ThrottlerGuard` (registration order in
 * `app.module.ts`): a misdirected request should be refused, not counted.
 */
@Injectable()
export class PortalAudienceGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const isPortalRoute =
      this.reflector.getAllAndOverride<boolean | undefined>(PORTAL_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;
    if (isPortalRoute) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (request.headers['x-portal-service'] !== undefined) {
      throw new DomainException(
        403,
        'WRONG_AUDIENCE',
        'This endpoint is not part of the transporter surface.',
      );
    }
    return true;
  }
}
