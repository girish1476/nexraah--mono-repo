import { IsDateString, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/**
 * `POST /payments/bills` — the desk raising a transporter's bill for them.
 * The bill a transporter hands over on paper or sends by WhatsApp is keyed
 * here, the same record the portal's own "raise a bill" writes.
 */
export class RaiseBillDto {
  @IsUUID() tripId!: string;
  @IsString() @MinLength(1) @MaxLength(60) billNo!: string;
  @IsDateString() billDate!: string;
  /** What the transporter's bill says. Omitted means "the balance we computed". */
  @IsOptional() @IsInt() @Min(0) totalPaise?: number;
  /** The scanned bill, uploaded first through `POST /attachments`. */
  @IsOptional() @IsUUID() attachmentId?: string;
}
