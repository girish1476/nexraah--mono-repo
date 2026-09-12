import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** A coordinate as a multipart text part — shape here, range in `geo.ts`. */
const SIGNED_DECIMAL = /^-?\d{1,3}(\.\d{1,10})?$/;

/**
 * The text parts of `POST /attachments`. This was a plain interface, which
 * the global `ValidationPipe` cannot see — so the `latitude`/`longitude` the
 * onboarding wizard sends with a selfie were accepted and ignored, and
 * nothing was validated at all. As a class it is now whitelisted like every
 * other body: exactly these five parts, which is exactly what the three
 * console callers send (`vendors/new`, `vendors/[id]`, trip documents).
 */
export class UploadMetadataDto {
  @IsOptional() @IsString() @MaxLength(60) kind?: string;
  @IsOptional() @IsString() @MaxLength(60) entityType?: string;
  @IsOptional() @IsString() @MaxLength(80) entityId?: string;
  @IsOptional() @Matches(SIGNED_DECIMAL) latitude?: string;
  @IsOptional() @Matches(SIGNED_DECIMAL) longitude?: string;
}
