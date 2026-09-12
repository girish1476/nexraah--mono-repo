import { IsDateString, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import { FORMAT_MESSAGE, GSTIN_SHAPE_RE, PHONE_RE } from '../../../common/validation/formats';

export class UpdateClientDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() billingCity?: string;
  @IsOptional() @IsIn(['SPOT', 'CONTRACT']) engagement?: 'SPOT' | 'CONTRACT';

  /** Shape only — the GSTN check stays advisory (see `formats.ts`). */
  @IsOptional() @Matches(GSTIN_SHAPE_RE, { message: FORMAT_MESSAGE.gstin }) gstin?: string;

  @IsOptional() @IsString() contact?: string;
  @IsOptional() @Matches(PHONE_RE, { message: FORMAT_MESSAGE.phone }) phone?: string;
  @IsOptional() @IsEmail({}, { message: 'That does not look like an email address.' }) email?: string;
  @IsOptional() @IsString() agreementNo?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsString() agreementAttachmentId?: string;
  @IsOptional() @IsInt() @Min(0) creditDays?: number;
  @IsOptional() @IsString() serviceLevel?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE']) status?: string;
}
