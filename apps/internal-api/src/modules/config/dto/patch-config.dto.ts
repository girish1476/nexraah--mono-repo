import { Type } from 'class-transformer';
import { TRIP_DOCUMENT_KINDS } from '../../trips/trips.constants';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { GSTIN_SHAPE_RE, PAN_RE } from '../../../common/validation/formats';

/** A detail the company added for itself — an MSME number, a TAN — printed under its GST number. */
class CompanyExtraDto {
  @IsString() @MinLength(1) @MaxLength(40) label!: string;
  @IsString() @MinLength(1) @MaxLength(120) value!: string;
}

class CompanyDto {
  @IsString() name!: string;
  @Matches(GSTIN_SHAPE_RE) gstin!: string;
  @Matches(PAN_RE) pan!: string;
  @IsString() cin!: string;
  @IsString() address!: string;
  @IsString() bank!: string;
  /** SAC — the GST service code printed on the invoice, e.g. 996511 for a
   *  goods transport agency's road transport service. */
  @IsString() sac!: string;
  /** The name/title printed under the signature line on a printed invoice
   *  — e.g. "Authorised Signatory", or a specific person once designated. */
  @IsString() signatory!: string;
  /** Details added from Admin → Control panel, in the order they were added. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => CompanyExtraDto)
  extra?: CompanyExtraDto[];
}

/** `docs/api/01-foundation.md` `PATCH /config` — partial patches accepted. */
export class PatchConfigDto {
  @IsOptional() @IsObject() modules?: Record<string, boolean>;

  @IsOptional() @IsBoolean() kyc_strict_gate?: boolean;
  @IsOptional() @IsIn(['MANUAL', 'API']) kyc_route?: 'MANUAL' | 'API';

  // Only documents that can actually be uploaded before the advance: the lorry
  // receipt and proof of delivery come later, and an unknown kind could never be
  // satisfied. An empty set would release money with no documents at all.
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(
    TRIP_DOCUMENT_KINDS.filter((k) => k.group !== 'LR' && k.group !== 'POD').map((k) => k.kind),
    { each: true },
  )
  advance_document_set?: string[];
  @IsOptional() @IsInt() @Min(0) advance_default_pct?: number;
  @IsOptional() @IsInt() @Min(0) credit_default_days?: number;
  @IsOptional() @IsInt() @Min(0) sla_hours?: number;

  @IsOptional() @IsInt() @Min(0) pod_tat_days?: number;
  @IsOptional() @IsInt() @Min(0) pod_penalty_per_day_paise?: number;
  @IsOptional() @IsInt() @Min(0) pod_forfeit_days?: number;
  /** Always paid out of a balance, however large the deductions. Below one hundred rupees. */
  @IsOptional() @IsInt() @Min(0) @Max(9900) min_balance_payable_paise?: number;

  @IsOptional() @IsInt() @Min(0) eway_warning_window_hours?: number;
  @IsOptional() @IsInt() @Min(0) overspeed_kmph?: number;
  @IsOptional() @IsInt() @Min(0) halt_minutes?: number;
  @IsOptional() @IsInt() @Min(0) dark_vehicle_interval_minutes?: number;
  @IsOptional() @IsInt() @Min(0) minimum_margin_pct?: number;
  @IsOptional() @IsInt() @Min(0) branch_catchment_km?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyDto)
  company?: CompanyDto;
}
