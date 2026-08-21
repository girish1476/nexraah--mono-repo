import { IsOptional, IsString } from 'class-validator';

/** `POST /vendors/:id/documents/:kind` — docs/api/02-vendors-compliance.md §1. */
export class SubmitDocumentDto {
  @IsString() attachmentId!: string;
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
}
