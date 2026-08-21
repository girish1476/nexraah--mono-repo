import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

@Injectable()
export class RolesRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  /** Current state of every role's grants — the `matrix` half of `GET /admin/roles`. */
  async getMatrix(): Promise<Map<string, Map<string, string>>> {
    const rows = await this.db
      .selectFrom('role_permissions')
      .innerJoin('roles', 'roles.id', 'role_permissions.role_id')
      .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
      .select(['roles.code as roleCode', 'permissions.code as permissionCode', 'role_permissions.level as level'])
      .execute();

    const matrix = new Map<string, Map<string, string>>();
    for (const row of rows) {
      if (!matrix.has(row.roleCode)) matrix.set(row.roleCode, new Map());
      matrix.get(row.roleCode)!.set(row.permissionCode, row.level);
    }
    return matrix;
  }

  /** `permission_code → owner_role_code` — `409 PERMISSION_FIXED` source of truth. */
  async getFixedOwners(): Promise<Map<string, string>> {
    const rows = await this.db.selectFrom('permission_fixed_owners').selectAll().execute();
    return new Map(rows.map((r) => [r.permission_code, r.owner_role_code]));
  }

  async findRoleId(db: DbExecutor, roleCode: string): Promise<string | undefined> {
    const row = await db.selectFrom('roles').select('id').where('code', '=', roleCode).executeTakeFirst();
    return row?.id;
  }

  async findPermissionId(db: DbExecutor, permissionCode: string): Promise<string | undefined> {
    const row = await db
      .selectFrom('permissions')
      .select('id')
      .where('code', '=', permissionCode)
      .executeTakeFirst();
    return row?.id;
  }

  async upsertGrant(db: DbExecutor, roleId: string, permissionId: string, level: string): Promise<void> {
    await db
      .insertInto('role_permissions')
      .values({ role_id: roleId, permission_id: permissionId, level })
      .onConflict((oc) => oc.columns(['role_id', 'permission_id']).doUpdateSet({ level }))
      .execute();
  }

  transaction() {
    return this.db.transaction();
  }
}
