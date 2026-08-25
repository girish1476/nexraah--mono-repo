import { IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RecordReceiptDto {
  @IsString() invoiceId!: string;
  @IsInt() @Min(1) amountPaise!: number; // receipts.amount check (> 0), BR-16
  @IsDateString() receivedOn!: string;
  @IsString() mode!: string;
  @IsString() reference!: string; // UTR / cheque number — mandatory
  @IsOptional() @IsString() remarks?: string;
}
