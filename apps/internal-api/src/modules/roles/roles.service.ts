import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { RolesRepository } from './roles.repository';
import { INTERNAL_ROLES, SEED_GRANTS } from './roles.constants';
import type { UpdateRolePermissionDto } from './dto/update-role-permission.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly rolesRepository: RolesRepository,
    private readonly auditService: AuditService,
  ) {}

  async getMatrix() {
    const matrix = await this.rolesRepository.getMatrix();
    return {
      roles: INTERNAL_ROLES,
      grants: SEED_GRANTS,
      matrix: Object.fromEntries(
        [...matrix.entries()].map(([role, grants]) => [role, Object.fromEntries(grants)]),
      ),
    };
  }

  async updatePermission(roleCode: string, dto: UpdateRolePermissionDto, actor: AuthenticatedUser) {
    if (!INTERNAL_ROLES.includes(roleCode as (typeof INTERNAL_ROLES)[number])) {
      throw new DomainException(404, 'NOT_FOUND', `Unknown role: ${roleCode}`);
    }

    const fixedOwners = await this.rolesRepository.getFixedOwners();
    // part 01 §2.4 / docs/api/01-foundation.md: the four fixed permissions
    // cannot be touched by this endpoint at all, on any role, in either
    // direction — `payment.release` staying FINANCE-only is the load-bearing
    // case (BR-40), but the rule is uniform across all four.
    if (fixedOwners.has(dto.permission)) {
      throw new DomainException(
        409,
        'PERMISSION_FIXED',
        `${dto.permission} is fixed to ${fixedOwners.get(dto.permission)} and cannot be changed here.`,
      );
    }

    const before = await this.rolesRepository.getMatrix();

    await this.rolesRepository.transaction().execute(async (trx) => {
      const roleId = await this.rolesRepository.findRoleId(trx, roleCode);
      const permissionId = await this.rolesRepository.findPermissionId(trx, dto.permission);
      if (!roleId || !permissionId) {
        throw new DomainException(404, 'NOT_FOUND', `Unknown role or permission.`);
      }

      await this.rolesRepository.upsertGrant(trx, roleId, permissionId, dto.level);
      // NFR-03 / part 01 §8.1: every role/permission change is audited.
      await this.auditService.record(trx, actor, {
        action: 'PERMISSION_CHANGED',
        entityType: 'role_permissions',
        entityId: roleId,
        before: { role: roleCode, permission: dto.permission, level: before.get(roleCode)?.get(dto.permission) ?? 'NONE' },
        after: { role: roleCode, permission: dto.permission, level: dto.level },
      });
    });

    return this.getMatrix();
  }
}
