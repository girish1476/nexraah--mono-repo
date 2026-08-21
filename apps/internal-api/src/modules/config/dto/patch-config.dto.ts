import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

class CompanyDto {
  @IsString() name!: string;
  @IsString() gstin!: string;
  @IsString() pan!: string;
  @IsString() cin!: string;
  @IsString() address!: string;
  @IsString() bank!: string;
}

/** `docs/api/01-foundation.md` `PATCH /config` — partial patches accepted. */
export class PatchConfigDto {
  @IsOptional() @IsObject() modules?: Record<string, boolean>;

  @IsOptional() @IsBoolean() kyc_strict_gate?: boolean;
  @IsOptional() @IsString() kyc_route?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) advance_document_set?: string[];
  @IsOptional() @IsInt() @Min(0) advance_default_pct?: number;
  @IsOptional() @IsInt() @Min(0) credit_default_days?: number;
  @IsOptional() @IsInt() @Min(0) sla_hours?: number;

  @IsOptional() @IsInt() @Min(0) pod_tat_days?: number;
  @IsOptional() @IsInt() @Min(0) pod_penalty_per_day_paise?: number;
  @IsOptional() @IsInt() @Min(0) pod_forfeit_days?: number;

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
