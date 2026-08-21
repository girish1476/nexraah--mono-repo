import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { errors as joseErrors } from 'jose';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';
import { validateEnv } from '../../config/env';
import { verifySupabaseJwt } from '../../lib/jwks';
import { DomainException } from '../domain-exception';
import type {
  AuthenticatedUser,
  InternalRole,
  PermissionLevel,
} from '../interfaces/authenticated-user.interface';

/**
 * Verifies the bearer token, then resolves it to an internal principal
 * (part 14 §4.1: `sub` → `users.auth_user_id`) and attaches `req.user`.
 *
 * A token that verifies but matches no `users` row — a transporter, whose
 * token comes from the same Supabase project — is rejected as
 * `403 WRONG_AUDIENCE` here, before `PermissionsGuard` runs. `docs/api/
 * 00-conventions.md` §4 and part 01 §2.5 are explicit that "no permission"
 * and "wrong audience" must not collapse into the same error.
 *
 * `X-Debug-Role` (the prototype role switcher header the frontend still
 * sends) is never read here. `00-conventions.md` §4: a real `internal-api`
 * ignores it.
 */
@Injectable()
export class SupabaseJwtGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    const env = validateEnv(process.env as Record<string, unknown>);

    let sub: string;
    try {
      const claims = await verifySupabaseJwt(token, env);
      sub = claims.sub;
    } catch (error) {
      if (error instanceof joseErrors.JOSEError) {
        throw new UnauthorizedException('Invalid or expired token.');
      }
      throw error;
    }

    const principal = await this.db
      .selectFrom('users')
      .innerJoin('roles', 'roles.id', 'users.role_id')
      .leftJoin('branches', 'branches.id', 'users.branch_id')
      .select([
        'users.id as userId',
        'users.auth_user_id as authUserId',
        'users.name as name',
        'users.email as email',
        'users.status as status',
        'users.role_id as roleId',
        'roles.code as roleCode',
        'branches.id as branchId',
        'branches.code as branchCode',
        'branches.name as branchName',
      ])
      .where('users.auth_user_id', '=', sub)
      .executeTakeFirst();

    if (!principal) {
      throw new DomainException(403, 'WRONG_AUDIENCE', 'This principal holds no internal role.');
    }
    if (principal.status === 'DISABLED') {
      throw new DomainException(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
    }

    const permissionRows = await this.db
      .selectFrom('role_permissions')
      .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
      .select(['permissions.code as code', 'role_permissions.level as level'])
      .where('role_permissions.role_id', '=', principal.roleId)
      .execute();

    const permissions = new Map<string, PermissionLevel>(
      permissionRows.map((p) => [p.code, p.level as PermissionLevel]),
    );

    const user: AuthenticatedUser = {
      userId: principal.userId,
      authUserId: principal.authUserId as string,
      name: principal.name,
      email: principal.email,
      role: principal.roleCode as InternalRole,
      branch: principal.branchId
        ? {
            id: principal.branchId,
            code: principal.branchCode as string,
            name: principal.branchName as string,
          }
        : null,
      permissions,
    };

    request.user = user;
    return true;
  }

  private extractToken(request: Request): string {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token.');
    }
    return header.slice('Bearer '.length);
  }
}
