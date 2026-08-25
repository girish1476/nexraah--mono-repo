import { IsArray, IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateInvoiceDto {
  @IsString() clientId!: string;
  @IsDateString() invoiceDate!: string;
  @IsDateString() dueDate!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tripIds?: string[];
  @IsInt() @Min(0) freightPaise!: number;
  @IsOptional() @IsInt() @Min(0) loadingPaise?: number;
  @IsOptional() @IsInt() @Min(0) unloadingPaise?: number;
  @IsOptional() @IsInt() @Min(0) detentionPaise?: number;
  @IsOptional() @IsInt() @Min(0) otherPaise?: number;
  @IsOptional() @IsInt() @Min(0) discountPaise?: number;
  @IsOptional() @IsString() notes?: string;
}
