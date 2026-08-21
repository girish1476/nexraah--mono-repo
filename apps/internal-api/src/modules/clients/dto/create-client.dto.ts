import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateClientDto {
  @IsString() name!: string;
  @IsString() billingCity!: string;
  @IsIn(['SPOT', 'CONTRACT']) engagement!: 'SPOT' | 'CONTRACT';

  @IsOptional() @IsString() gstin?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() agreementNo?: string;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
  @IsOptional() @IsString() agreementAttachmentId?: string;
  @IsOptional() @IsInt() @Min(0) creditDays?: number;
  @IsOptional() @IsString() serviceLevel?: string;
}
