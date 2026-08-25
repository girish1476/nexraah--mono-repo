import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { FORMAT_MESSAGE, GSTIN_SHAPE_RE, PHONE_RE } from '../../../common/validation/formats';

/**
 * `POST /vendors` — internal-spec/03-C2 §1 step 1. Creates the `DRAFT`.
 *
 * `phone` and `gstin` are format-checked here now. They were `@IsString()`,
 * while the onboarding wizard (`app/vendors/new/page.tsx`) has enforced a
 * ten-digit Indian mobile and a GSTIN shape all along — so the rules existed,
 * just not anywhere that a caller other than that form had to obey them.
 */
export class CreateVendorDto {
  @IsString() @MinLength(2) @MaxLength(160) legalName!: string;
  @IsIn(['OWNER', 'VENDOR']) partyType!: 'OWNER' | 'VENDOR';
  @IsString() @MinLength(2) @MaxLength(80) baseCity!: string;

  @Matches(PHONE_RE, { message: FORMAT_MESSAGE.phone }) phone!: string;

  /** Shape only — the GSTN check stays advisory (see `formats.ts`). */
  @IsOptional() @Matches(GSTIN_SHAPE_RE, { message: FORMAT_MESSAGE.gstin }) gstin?: string;

  @IsOptional() @Matches(PHONE_RE, { message: FORMAT_MESSAGE.phone }) altPhone?: string;

  // BR-30: the standing default set at onboarding, not yet a "change" (BR-57
  // governs anything after this). Defaults to 0 (config.advance_default_pct
  // is the console's suggested starting value, applied client-side).
  @IsOptional() @IsInt() @Min(0) @Max(100) advancePct?: number;

  // BR-34/BR-47: omit to auto-derive from `baseCity`; supply to override, which
  // then requires `branchOverrideReason` if it disagrees with the derivation.
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() @MinLength(20) @MaxLength(500) branchOverrideReason?: string;

  // When set, this vendor is created from that lead: the lead's `source`
  // carries over and the lead flips to CONVERTED, linked to this vendor, in
  // the same transaction as the insert.
  @IsOptional() @IsUUID() leadId?: string;
}
