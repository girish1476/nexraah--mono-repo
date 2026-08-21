import { IsIn, IsOptional, IsString } from 'class-validator';

/** `POST /vendors/:id/kyc/:kind` — internal-spec/03-C2 §1: BR-31. */
export class SubmitKycDto {
  @IsOptional() @IsString() value?: string;
  @IsIn(['API', 'MANUAL']) route!: 'API' | 'MANUAL';
  // BR-23: the card photograph, uploaded first via POST /attachments.
  @IsOptional() @IsString() attachmentId?: string;
}
