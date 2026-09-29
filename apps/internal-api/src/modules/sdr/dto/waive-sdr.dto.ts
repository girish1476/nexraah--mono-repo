import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/** What is still owed on an SDR, waived on Leadership's mail and recorded by Compliance. */
export class WaiveSdrDto {
  @IsString() @MinLength(5) mailSubject!: string;
  @IsOptional() @IsUUID() mailAttachmentId?: string;
  @IsOptional() @IsString() note?: string;
}
