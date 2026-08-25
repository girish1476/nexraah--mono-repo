import { IsIn, IsOptional, IsString } from 'class-validator';

export class DecideClientDocumentDto {
  @IsIn(['VERIFIED', 'REJECTED'])
  status!: 'VERIFIED' | 'REJECTED';

  /** Required by the service when rejecting — the client has to be told what
   *  to fix, so a bare rejection is refused there rather than here, where the
   *  rule would be invisible to anyone reading the service. */
  @IsOptional() @IsString() reason?: string;
}
