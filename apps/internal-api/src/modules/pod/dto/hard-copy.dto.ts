import { ArrayMaxSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * `POST /pod/:tripId/hard-copy` — the hard copy (H-POD) behind an E-POD.
 * Either its courier details while it is on the way, or the scan of the hard
 * copy itself once it has arrived — or both. The scan is what the balance
 * waits for, together with a check (`POST /pod/:tripId/hard-copy/verify`).
 */
export class HardCopyDto {
  /** The scanned pages of the signed hard copy, uploaded through `/attachments`. */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) attachmentIds?: string[];
  @IsOptional() @IsString() @MinLength(3) courierDocket?: string;
  @IsOptional() @IsDateString() sentOn?: string;
  /** Defaults to today when the scan is uploaded. */
  @IsOptional() @IsDateString() receivedOn?: string;
  @IsOptional() @IsUUID() courierSlipAttachmentId?: string;
}
