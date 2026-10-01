import { IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * `POST /pod/:tripId/hard-copy` — the follow-up after an E-POD: the signed
 * hard copy's courier docket and the date it was sent, the date it reached
 * head office once it has, and a photo of the courier slip.
 */
export class HardCopyDto {
  @IsString() @MinLength(3) courierDocket!: string;
  @IsDateString() sentOn!: string;
  /** Left out while the hard copy is still on its way to head office. */
  @IsOptional() @IsDateString() receivedOn?: string;
  @IsOptional() @IsUUID() courierSlipAttachmentId?: string;
}
