import { IsObject, IsOptional, IsString } from 'class-validator';

export class SubmitTripDocumentDto {
  @IsOptional() @IsString() attachmentId?: string;
  // Feeds the cross-check until NIC/OCR is connected (docs/api/04 §Documents).
  @IsOptional() @IsObject() keyedValues?: Record<string, unknown>;
}
