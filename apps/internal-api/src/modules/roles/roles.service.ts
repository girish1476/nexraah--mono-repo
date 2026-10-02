import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { RolesRepository } from './roles.repository';
import { INTERNAL_ROLES, SEED_GRANTS } from './roles.constants';
import type { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import type { CreateRoleDto } from './dto/create-role.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly rolesRepository: RolesRepository,
    private readonly auditService: AuditService,
  ) {}

  async getMatrix() {
    const [matrix, customRoles] = await Promise.all([
      this.rolesRepository.getMatrix(),
      this.rolesRepository.listCustomRoles(),
    ]);
    return {
      roles: INTERNAL_ROLES,
      // Roles an administrator added. They have no seed grants — everything
      // they hold is in `matrix`.
      customRoles: customRoles.map((r) => ({ code: r.code, label: r.name, basedOn: r.basedOn as string })),
      grants: SEED_GRANTS,
      matrix: Object.fromEntries(
        [...matrix.entries()].map(([role, grants]) => [role, Object.fromEntries(grants)]),
      ),
    };
  }

  /**
   * Add a custom role. It opens the screens of the built-in role it is based
   * on and starts with that role's permissions — minus the fixed ones, which
   * never belong to a second role (BR-40, BR-43). From there the matrix
   * checkboxes grant and remove as for any other role.
   */
  async createRole(dto: CreateRoleDto, actor: AuthenticatedUser) {
    const name = dto.name.trim().replace(/\s+/g, ' ');
    const code = `CUSTOM_${name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')}`;

    await this.rolesRepository.transaction().execute(async (trx) => {
      if (await this.rolesRepository.findRole(trx, code)) {
        throw new DomainException(409, 'ROLE_EXISTS', `A role named "${name}" already exists.`);
      }
      const base = await this.rolesRepository.findRole(trx, dto.basedOn);
      if (!base) throw new DomainException(404, 'NOT_FOUND', `Unknown role: ${dto.basedOn}`);

      const fixedOwners = await this.rolesRepository.getFixedOwners();
      const roleId = await this.rolesRepository.insertRole(trx, { code, name, based_on: dto.basedOn });
      await this.rolesRepository.copyGrants(trx, base.id, roleId, [...fixedOwners.keys()]);

      await this.auditService.record(trx, actor, {
        action: 'ROLE_CREATED',
        entityType: 'roles',
        entityId: roleId,
        after: { role: code, name, basedOn: dto.basedOn },
      });
    });

    return this.getMatrix();
  }

  /** Only a custom role, and only once nobody signs in with it. */
  async deleteRole(roleCode: string, actor: AuthenticatedUser) {
    await this.rolesRepository.transaction().execute(async (trx) => {
      const role = await this.rolesRepository.findRole(trx, roleCode);
      if (!role) throw new DomainException(404, 'NOT_FOUND', `Unknown role: ${roleCode}`);
      if (!role.basedOn) {
        throw new DomainException(409, 'ROLE_BUILT_IN', `${role.name} is a built-in role and cannot be removed.`);
      }
      const users = await this.rolesRepository.countUsersWithRole(trx, role.id);
      if (users > 0) {
        throw new DomainException(
          409,
          'ROLE_IN_USE',
          `${users} ${users === 1 ? 'person still signs' : 'people still sign'} in as ${role.name}. Move them to another role first.`,
        );
      }
      await this.rolesRepository.deleteRole(trx, role.id);
      await this.auditService.record(trx, actor, {
        action: 'ROLE_DELETED',
        entityType: 'roles',
        entityId: role.id,
        before: { role: role.code, name: role.name, basedOn: role.basedOn },
      });
    });

    return this.getMatrix();
  }

  async updatePermission(roleCode: string, dto: UpdateRolePermissionDto, actor: AuthenticatedUser) {
    // A built-in role, or a custom one an administrator added — nothing else
    // in `roles` (a retired code, say) is editable here.
    if (!INTERNAL_ROLES.includes(roleCode as (typeof INTERNAL_ROLES)[number])) {
      const role = await this.rolesRepository.findRole(this.rolesRepository.reader(), roleCode);
      if (!role?.basedOn) throw new DomainException(404, 'NOT_FOUND', `Unknown role: ${roleCode}`);
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
