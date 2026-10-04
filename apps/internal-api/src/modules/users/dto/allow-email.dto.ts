import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** An Indian mobile number: ten digits starting 6–9, with an optional +91 / 91 / 0 in front and spaces or hyphens between. */
export const MOBILE_RE = /^(\+91|91|0)?[\s-]*[6-9](?:[\s-]*\d){9}$/;

/** A typed mobile number as it is stored: the ten digits alone. */
export function mobileOf(raw: string): string {
  return raw.replace(/\D/g, '').slice(-10);
}

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
  // The person's mobile — ten digits, a +91 / 0 prefix and spaces tolerated.
  // The console asks for it on every new person; it stays optional here so the
  // people added before it was asked for can still be edited.
  @IsOptional() @Matches(MOBILE_RE, { message: 'Enter a 10-digit mobile number.' }) phone?: string;
  // Present → the person sees only that branch. Absent → the whole company.
  @IsOptional() @IsUUID() branchId?: string;
}

/** `PATCH /admin/users/:id` — change the role, branch, name, or switch access off/on. */
export class UpdateAllowedEmailDto {
  @IsOptional() @IsString() @MaxLength(60) role?: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @Matches(MOBILE_RE, { message: 'Enter a 10-digit mobile number.' }) phone?: string;
  // `null` clears the branch (whole company); a uuid scopes them to it.
  @IsOptional() @IsUUID() branchId?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: 'ACTIVE' | 'DISABLED';
}
