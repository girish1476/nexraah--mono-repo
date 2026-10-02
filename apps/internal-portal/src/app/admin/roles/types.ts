import { Level, Permission, RoleCode } from '@/lib/permissions';

/**
 * A role an administrator added. It opens the screens of the built-in role it
 * is based on; what it may do there is its own row in `matrix`.
 */
export interface CustomRole {
  code: string;
  label: string;
  basedOn: RoleCode;
}

export interface RoleMatrixResponse {
  roles: RoleCode[];
  /** Absent from an older server — read as none. */
  customRoles?: CustomRole[];
  /** Seeded grants per role — part 01 §2.4. */
  grants: Record<RoleCode, Permission[]>;
  /** Overrides applied since seeding, role → permission → level. */
  matrix: Record<string, Record<string, Level>>;
}

export interface GrantChange {
  permission: Permission;
  level: Level;
}
