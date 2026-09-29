import { IsIn, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * A penalty waived on Leadership's mail, recorded by Compliance. The mail's
 * subject is the evidence, so it is required; its screenshot is optional.
 */
export class WaivePenaltyDto {
  /** Which penalty: the paperwork (POD) one, or the late-delivery (transit) one. */
  @IsIn(['POD_PENALTY', 'TRANSIT_PENALTY']) kind!: 'POD_PENALTY' | 'TRANSIT_PENALTY';
  @IsString() @MinLength(5) mailSubject!: string;
  @IsOptional() @IsUUID() mailAttachmentId?: string;
  @IsOptional() @IsString() note?: string;
}
