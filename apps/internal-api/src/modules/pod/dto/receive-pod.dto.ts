import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * `POST /pod/:tripId/receive` — the H-POD: the signed hard copy, scanned and
 * uploaded through `/attachments` first. The scan is what the desk needs;
 * the courier docket and dates are optional extras (BR-51 still ties docket
 * and sent-on together — both or neither).
 */
export class ReceivePodDto {
  /** The scanned pages of the signed hard copy. Required unless a docket is given (older callers). */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true }) attachmentIds?: string[];
  @IsOptional() @IsString() courierDocket?: string;
  @IsOptional() @IsString() sentOn?: string;
  /** Defaults to today. */
  @IsOptional() @IsString() receivedOn?: string;
  @IsOptional() @IsInt() @Min(1) pages?: number;
  /**
   * Who signed for the courier. Optional: the receiving register has no
   * field for it, so the service records the signed-in user.
   */
  @IsOptional() @IsString() receivedBy?: string;
  @IsOptional() @IsString() condition?: string;
  /** A photo of the courier slip, uploaded through `/attachments`. */
  @IsOptional() @IsString() courierSlipAttachmentId?: string;
}
