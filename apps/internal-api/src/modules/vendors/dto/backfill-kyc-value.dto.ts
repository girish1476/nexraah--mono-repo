import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * `PATCH /vendors/:id/kyc/:kind/value` — fills in `value_masked` on a PAN or
 * AADHAAR row that was captured (photo on file) before
 * `20260826_..._pan_aadhaar_needs_reference_fix` but never had its typed
 * value stored, because the wizard's capture field was suppressed for those
 * two kinds. Not a re-submission: it does not touch `status`/`verified_by`,
 * so re-keying the value off the stored photo doesn't undo an existing
 * verification.
 */
export class BackfillKycValueDto {
  @IsString() @MinLength(1) @MaxLength(10) value!: string;
}
