import { IsIn, IsString } from 'class-validator';

/** `docs/api/01-foundation.md` `PATCH /admin/roles/:role/permissions`. */
export class UpdateRolePermissionDto {
  @IsString()
  permission!: string;

  @IsIn(['NONE', 'VIEW', 'EDIT'])
  level!: 'NONE' | 'VIEW' | 'EDIT';
}
