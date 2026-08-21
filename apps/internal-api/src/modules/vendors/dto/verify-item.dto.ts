import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Shared by `POST /vendors/:id/kyc/:kind/verify` and the (undocumented but
 * necessary — compliance desk "Verify each" needs a document-side action too)
 * `POST /vendors/:id/documents/:kind/verify`. Defaults to approve; a rejection
 * needs a reason, same ≥20-char floor as every other mandatory reason field.
 */
export class VerifyItemDto {
  @IsOptional() @IsBoolean() approve?: boolean;
  @IsOptional() @IsString() @MinLength(20) reason?: string;
}
