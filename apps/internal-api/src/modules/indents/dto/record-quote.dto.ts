import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class RecordQuoteDto {
  @IsUUID() vendorId!: string;
  @IsInt() @Min(1) amountPaise!: number;
  @IsOptional() @IsString() truckRegistration?: string;
  @IsOptional() @IsString() remarks?: string;
}
