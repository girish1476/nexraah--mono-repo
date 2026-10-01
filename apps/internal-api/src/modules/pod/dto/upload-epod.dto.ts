import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

/**
 * `POST /pod/:tripId/epod` — the proof of delivery as an electronic copy
 * (E-POD): a photo or scan of the signed delivery note, uploaded through
 * `/attachments` first. It stands in for the courier hard copy (H-POD): it
 * stops the clock and can be verified straight away.
 */
export class UploadEpodDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUUID('all', { each: true }) attachmentIds!: string[];
  @IsOptional() @IsString() note?: string;
}
