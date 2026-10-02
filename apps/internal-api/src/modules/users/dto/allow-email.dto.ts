import { IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * `POST /admin/users` — allow an email to sign in, with the role it gets.
 *
 * `role` is a built-in role code or a custom one added from Access control,
 * so it cannot be a fixed list here — `UsersService` checks it against the
 * `roles` table.
 */
export class AllowEmailDto {
  @IsEmail() email!: string;
  @IsString() @MaxLength(60) role!: string;
  // Optional: defaults to the part of the email before the @, and the person
  // can be renamed later. Asking for it up front only slowed the add down.
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  // Present → the person sees only that branch. Absent → the whole company.
  @IsOptional() @IsUUID() branchId?: string;
}

/** `PATCH /admin/users/:id` — change the role, branch, name, or switch access off/on. */
export class UpdateAllowedEmailDto {
  @IsOptional() @IsString() @MaxLength(60) role?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  // `null` clears the branch (whole company); a uuid scopes them to it.
  @IsOptional() @IsUUID() branchId?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
}
