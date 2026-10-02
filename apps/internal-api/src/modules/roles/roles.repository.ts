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

  /** Custom roles, oldest first — the ones an administrator added. */
  listCustomRoles() {
    return this.db
      .selectFrom('roles')
      .select(['code', 'name', 'based_on as basedOn'])
      .where('based_on', 'is not', null)
      .orderBy('created_at', 'asc')
      .execute();
  }

  findRole(db: DbExecutor, roleCode: string) {
    return db
      .selectFrom('roles')
      .select(['id', 'code', 'name', 'based_on as basedOn'])
      .where('code', '=', roleCode)
      .executeTakeFirst();
  }

  async insertRole(db: DbExecutor, row: { code: string; name: string; based_on: string }): Promise<string> {
    const inserted = await db.insertInto('roles').values(row).returning('id').executeTakeFirstOrThrow();
    return inserted.id;
  }

  /** Copies every grant the source role holds, except the named permission codes. */
  async copyGrants(db: DbExecutor, fromRoleId: string, toRoleId: string, exceptCodes: string[]): Promise<void> {
    let query = db
      .selectFrom('role_permissions')
      .innerJoin('permissions', 'permissions.id', 'role_permissions.permission_id')
      .select(['role_permissions.permission_id as permissionId', 'role_permissions.level as level'])
      .where('role_permissions.role_id', '=', fromRoleId)
      .where('role_permissions.level', '!=', 'NONE');
    if (exceptCodes.length > 0) query = query.where('permissions.code', 'not in', exceptCodes);
    const rows = await query.execute();
    if (rows.length === 0) return;
    await db
      .insertInto('role_permissions')
      .values(rows.map((r) => ({ role_id: toRoleId, permission_id: r.permissionId, level: r.level })))
      .execute();
  }

  async countUsersWithRole(db: DbExecutor, roleId: string): Promise<number> {
    const row = await db
      .selectFrom('users')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('role_id', '=', roleId)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  /** `role_permissions` rows go with it — the foreign key cascades. */
  async deleteRole(db: DbExecutor, roleId: string): Promise<void> {
    await db.deleteFrom('roles').where('id', '=', roleId).execute();
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

  /** The plain connection, for a read that needs no transaction. */
  reader(): DbExecutor {
    return this.db;
  }

  transaction() {
    return this.db.transaction();
  }
}
