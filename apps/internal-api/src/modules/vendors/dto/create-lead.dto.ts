import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateLeadDto {
  @IsString() name!: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsIn(['OWNER', 'VENDOR']) partyType?: 'OWNER' | 'VENDOR';
  @IsOptional() @IsInt() @Min(0) trucksClaimed?: number;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() notes?: string;
}
