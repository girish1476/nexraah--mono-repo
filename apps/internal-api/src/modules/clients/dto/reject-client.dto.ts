import { IsString } from 'class-validator';

export class RejectClientDto {
  /** Recorded against the client and shown whenever their file is opened, so
   *  "why did we decline them?" has an answer a year later. Presence only at
   *  the DTO layer — the real ≥20-char rule is enforced once, by
   *  `assertReason` in `client-onboarding.service.ts`, the same helper every
   *  other mandatory-reason field in the system goes through. */
  @IsString()
  reason!: string;
}
