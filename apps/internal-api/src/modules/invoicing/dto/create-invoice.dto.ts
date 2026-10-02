import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** A named charge line beyond the fixed heads — the form's "+ Add charge". */
export class ExtraChargeDto {
  @IsString() @IsNotEmpty() @MaxLength(60) label!: string;
  @IsInt() @Min(0) amountPaise!: number;
}

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
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExtraChargeDto)
  extraCharges?: ExtraChargeDto[];
  @IsOptional() @IsString() notes?: string;
}
