import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength } from 'class-validator';

export const SDR_KINDS = ['SHORTAGE', 'DAMAGE', 'UNLOADING_ACK'] as const;
export type SdrKind = (typeof SDR_KINDS)[number];

export class RaiseSdrDto {
  @IsIn(SDR_KINDS as unknown as string[]) kind!: SdrKind;
  @IsString() @MinLength(5) @MaxLength(1000) description!: string;
  @IsOptional() @IsInt() @Min(0) claimedAmountPaise?: number;
}

export class ResolveSdrDto {
  /** What to take from the transporter. 0 dismisses the record. */
  @IsInt() @Min(0) deductionPaise!: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
