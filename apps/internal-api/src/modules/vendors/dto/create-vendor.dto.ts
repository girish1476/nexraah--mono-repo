import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** `POST /vendors` — internal-spec/03-C2 §1 step 1. Creates the `DRAFT`. */
export class CreateVendorDto {
  @IsString() legalName!: string;
  @IsIn(['OWNER', 'VENDOR']) partyType!: 'OWNER' | 'VENDOR';
  @IsString() baseCity!: string;
  @IsString() phone!: string;

  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() altPhone?: string;

  // BR-30: the standing default set at onboarding, not yet a "change" (BR-57
  // governs anything after this). Defaults to 0 (config.advance_default_pct
  // is the console's suggested starting value, applied client-side).
  @IsOptional() @IsInt() @Min(0) @Max(100) advancePct?: number;

  // BR-34/BR-47: omit to auto-derive from `baseCity`; supply to override, which
  // then requires `branchOverrideReason` if it disagrees with the derivation.
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() @MinLength(20) branchOverrideReason?: string;

  // When set, this vendor is created from that lead: the lead's `source`
  // carries over and the lead flips to CONVERTED, linked to this vendor, in
  // the same transaction as the insert.
  @IsOptional() @IsString() leadId?: string;
}
