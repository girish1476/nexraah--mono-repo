import { Level, Permission, RoleCode } from '@/lib/permissions';

export interface RoleMatrixResponse {
  roles: RoleCode[];
  /** Seeded grants per role — part 01 §2.4. */
  grants: Record<RoleCode, Permission[]>;
  /** Overrides applied since seeding, role → permission → level. */
  matrix: Record<string, Record<string, Level>>;
}

export interface GrantChange {
  permission: Permission;
  level: Level;
}
