import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * `POST /pod/:tripId/epod` — the proof of delivery as an electronic copy
 * (E-POD): a photo or scan of the signed delivery note, uploaded through
 * `/attachments` first. It stops the clock and can be verified and approved
 * straight away — but the balance stays held until the hard copy (H-POD)
 * behind it is uploaded and verified.
 */
export class UploadEpodDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('all', { each: true }) attachmentIds!: string[];
  @IsOptional() @IsString() note?: string;
  /** Optional: the hard copy's courier docket, if it has already been sent. */
  @IsOptional() @IsString() @MinLength(3) hardCopyDocket?: string;
  /** When the hard copy was sent. Defaults to today when a docket is given. */
  @IsOptional() @IsDateString() hardCopySentOn?: string;
}
