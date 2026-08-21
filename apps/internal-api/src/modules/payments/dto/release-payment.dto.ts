import { IsString } from 'class-validator';

/** BR-09 — every one of these is `NOT NULL` on `payments`. */
export class ReleasePaymentDto {
  @IsString() mode!: string;
  @IsString() transferType!: string;
  @IsString() remittingAccount!: string;
  @IsString() utr!: string;
  @IsString() valueDate!: string;
}
