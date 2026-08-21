import { IsString, MinLength } from 'class-validator';

/** `docs/api/01-foundation.md` `POST /approvals/:id/reject` — note is mandatory. */
export class RejectApprovalDto {
  @IsString()
  @MinLength(1)
  note!: string;
}
