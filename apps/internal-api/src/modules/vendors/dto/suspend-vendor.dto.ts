import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `POST /vendors/:id/suspend`. The reason is the whole point of the body —
 * it lands on the audit trail as the answer to "why did this transporter
 * stop getting loads", so it takes the same ≥ 20-character rule every other
 * mandatory reason in the system does (`assertReason`).
 */
export class SuspendVendorDto {
  @IsString()
  @MinLength(20, { message: 'Say why in at least 20 characters — it is written to the audit trail.' })
  @MaxLength(500)
  reason!: string;
}
