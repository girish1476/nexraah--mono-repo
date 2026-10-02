import { IsObject, IsOptional } from 'class-validator';

/**
 * `POST /trips/:id/documents/:kind/verify` — the verification team checks the
 * file and types the details off it (invoice number, e-way bill validity,
 * RC number…). The uploader only uploads; the details are the checker's.
 */
export class VerifyTripDocumentDto {
  @IsOptional() @IsObject() keyedValues?: Record<string, unknown>;
}
