import {
  IsDateString,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FORMAT_MESSAGE, GSTIN_SHAPE_RE, PHONE_RE } from '../../../common/validation/formats';

/**
 * `POST /clients`.
 *
 * Every optional field here used to be `@IsString()` and nothing more — the
 * email was not checked as an email, the dates not as dates, the ids not as
 * ids, and the GSTIN and phone not at all, though the portal's own form
 * (`app/clients/new/page.tsx`) validates the last two. Client-side rules the
 * server does not repeat are not validation; they are a suggestion to whoever
 * happens to use the form.
 */
export class CreateClientDto {
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsString() @MinLength(2) @MaxLength(80) billingCity!: string;
  @IsIn(['SPOT', 'CONTRACT']) engagement!: 'SPOT' | 'CONTRACT';

  /** Shape only — the GSTN check stays advisory (see `formats.ts`). */
  @IsOptional() @Matches(GSTIN_SHAPE_RE, { message: FORMAT_MESSAGE.gstin }) gstin?: string;

  @IsOptional() @IsString() @MaxLength(120) contact?: string;
  @IsOptional() @Matches(PHONE_RE, { message: FORMAT_MESSAGE.phone }) phone?: string;
  @IsOptional() @IsEmail({}, { message: 'That does not look like an email address.' }) email?: string;
  @IsOptional() @IsString() @MaxLength(80) agreementNo?: string;

  /*
   * Dates, not strings. `valid_from`/`valid_to` are `date` columns, so a
   * malformed value here becomes a database error at the very end of a
   * request instead of a field-level message at the start of one.
   */
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;

  @IsOptional() @IsUUID() agreementAttachmentId?: string;

  @IsOptional() @IsInt() @Min(0) creditDays?: number;
  @IsOptional() @IsString() @MaxLength(120) serviceLevel?: string;
}
