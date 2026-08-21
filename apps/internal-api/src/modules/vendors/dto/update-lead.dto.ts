import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const STAGES = ['NEW', 'CONTACTED', 'DOCUMENTS_REQUESTED', 'QUALIFIED', 'CONVERTED', 'DROPPED'] as const;

export class UpdateLeadDto {
  @IsOptional() @IsIn(STAGES) stage?: (typeof STAGES)[number];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsInt() @Min(0) trucksClaimed?: number;
}
