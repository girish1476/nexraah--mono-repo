import { IsEmail, MaxLength } from 'class-validator';

/** `POST /vendors/:id/portal-login` — the address the transporter will sign in with. */
export class CreatePortalLoginDto {
  @IsEmail({}, { message: 'Enter a valid email, e.g. accounts@transporter.in' })
  @MaxLength(200)
  email!: string;
}
