import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** `PATCH /vendors/:id` — per-step draft save (internal-spec/03-C2 §1). */
export class UpdateVendorDto {
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsIn(['OWNER', 'VENDOR']) partyType?: 'OWNER' | 'VENDOR';
  @IsOptional() @IsString() baseCity?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() altPhone?: string;

  @IsOptional() @IsInt() @Min(0) fleetBase?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) operatingStates?: string[];

  // Onboarding wizard step 3 (part 03 §1) — self-reported, stored on
  // `declared_fleet_count`/`truck_types`/`fleet_body_type`, distinct from
  // `vendor_fleet`'s actual registered-truck rows.
  @IsOptional() @IsInt() @Min(0) fleetCount?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) truckTypes?: string[];
  @IsOptional() @IsString() bodyType?: string;

  @IsOptional() @IsString() bankAccount?: string;
  @IsOptional() @IsString() ifsc?: string;
  @IsOptional() @IsString() accountHolder?: string;

  // Settable directly only while the vendor is still onboarding (service
  // enforces `status !== 'ACTIVE'`) — BR-57 gates anything after activation
  // behind `PATCH /vendors/:id/advance-policy` instead.
  @IsOptional() @IsInt() @Min(0) @Max(100) advancePct?: number;

  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() panelDate?: string;

  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() @MinLength(20) branchOverrideReason?: string;
}
