import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';

const STAGES = ['NEW', 'CONTACTED', 'DOCUMENTS_REQUESTED', 'QUALIFIED', 'CONVERTED', 'DROPPED'] as const;

export class UpdateLeadDto {
  @IsOptional() @IsIn(STAGES) stage?: (typeof STAGES)[number];
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsIn(['OWNER', 'VENDOR']) partyType?: 'OWNER' | 'VENDOR';
  @IsOptional() @IsInt() @Min(0) trucksClaimed?: number;
  /** The transporter this lead already became, when it was onboarded without being opened from the lead. */
  @IsOptional() @IsUUID() convertedVendorId?: string;
}
