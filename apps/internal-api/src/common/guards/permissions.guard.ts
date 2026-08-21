import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { DomainException } from '../domain-exception';
import { REQUIRE_PERMISSION_KEY, type RequiredPermission } from '../decorators/require-permission.decorator';
import type { PermissionLevel } from '../interfaces/authenticated-user.interface';

const LEVEL_RANK: Record<PermissionLevel, number> = { NONE: 0, VIEW: 1, EDIT: 2 };

/**
 * Runs after `SupabaseJwtGuard`, which has already rejected a principal with
 * no internal role. This guard only ever answers "does this internal
 * principal hold the named permission at the required level" — part 01 §2.5.
 * No `@RequirePermission` on the handler means "any authenticated internal
 * principal", which is itself a deliberate choice, not an oversight.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Method-level overrides class-level; a controller may set one
    // `@RequirePermission` for every route (payments.controller.ts — BR-40)
    // instead of repeating it per method. `reflector.get(..., getHandler())`
    // alone would silently ignore a class-level decorator, which for a
    // payment-release gate is not a cosmetic miss.
    const required = this.reflector.getAllAndOverride<RequiredPermission | undefined>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const level = request.user?.permissions.get(required.code) ?? 'NONE';

    if (LEVEL_RANK[level] < LEVEL_RANK[required.level]) {
      throw new DomainException(403, 'PERMISSION_DENIED', `Missing permission: ${required.code}.`);
    }
    return true;
  }
}
