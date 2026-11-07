import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ExtraChargeDto } from './create-invoice.dto';

/**
 * A manual invoice as the builder sends it. Shapes only: what an invoice must
 * carry to be a valid GST invoice is `checkManualInvoice` in
 * common/manual-invoice.ts, which the console runs too, so its words reach the
 * person filling it in.
 */
export class ManualPartyDto {
  @IsString() @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(400) address?: string;
  @IsOptional() @IsString() @MaxLength(15) gstin?: string;
}

export class ManualBillToDto extends ManualPartyDto {
  @IsString() @MaxLength(60) state!: string;
}

export class ManualItemDto {
  @IsString() @IsNotEmpty() @MaxLength(300) description!: string;
  @IsOptional() @IsString() @MaxLength(8) sac?: string;
  @IsNumber() @Min(0) qty!: number;
  @IsString() @IsNotEmpty() @MaxLength(12) unit!: string;
  @IsInt() @Min(0) ratePaise!: number;
}

export class ManualInvoiceDto {
  @IsString() clientId!: string;
  @IsString() invoiceDate!: string;
  @IsString() dueDate!: string;
  @ValidateNested() @Type(() => ManualBillToDto) billTo!: ManualBillToDto;
  @IsString() @MaxLength(60) placeOfSupply!: string;
  @IsOptional() @IsString() @MaxLength(60) clientRef?: string;
  @ValidateNested() @Type(() => ManualPartyDto) consignor!: ManualPartyDto;
  @ValidateNested() @Type(() => ManualPartyDto) consignee!: ManualPartyDto;
  @IsString() @MaxLength(20) vehicleNo!: string;
  @IsOptional() @IsString() @MaxLength(30) lrNo?: string;
  @IsOptional() @IsString() @MaxLength(10) lrDate?: string;
  @IsString() @MaxLength(80) fromPlace!: string;
  @IsString() @MaxLength(80) toPlace!: string;
  @IsString() @MaxLength(200) goods!: string;
  @IsOptional() @IsString() @MaxLength(60) packages?: string;
  @IsNumber() @Min(0) grossWeightKg!: number;
  @IsIn(['BILL_TO', 'CONSIGNOR', 'CONSIGNEE']) taxPaidBy!: 'BILL_TO' | 'CONSIGNOR' | 'CONSIGNEE';
  @IsInt() rcmRatePct!: number;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ManualItemDto)
  items!: ManualItemDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ExtraChargeDto)
  extraCharges?: ExtraChargeDto[];
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /** Issue it now (number it) rather than leave it as a draft. */
  @IsOptional() @IsBoolean() issue?: boolean;
}

export class ManualInvoiceBulkDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ManualInvoiceDto)
  invoices!: ManualInvoiceDto[];
  @IsOptional() @IsBoolean() issue?: boolean;
}
