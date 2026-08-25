import { IsIn, IsOptional, IsString, IsUUID, IsDateString } from 'class-validator';
import { CLIENT_DOCUMENT_KINDS, type ClientDocumentKind } from '../client-onboarding';

export class SubmitClientDocumentDto {
  @IsIn(CLIENT_DOCUMENT_KINDS as unknown as string[])
  kind!: ClientDocumentKind;

  /** The uploaded file. Optional so a reference-only record (a GSTIN checked
   *  on the portal, say) can be logged without a scan. */
  @IsOptional() @IsUUID() attachmentId?: string;

  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
}
