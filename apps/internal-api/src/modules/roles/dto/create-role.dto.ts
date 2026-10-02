import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CUSTOM_ROLE_BASES } from '../roles.constants';

/** `POST /admin/roles` — add a custom role. */
export class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  // At least one letter or digit, so the name yields a usable code.
  @Matches(/[A-Za-z0-9]/, { message: 'name must contain a letter or a number' })
  name!: string;

  /** The built-in role whose screens this one opens, and whose permissions it starts with. */
  @IsIn([...CUSTOM_ROLE_BASES])
  basedOn!: string;
}
