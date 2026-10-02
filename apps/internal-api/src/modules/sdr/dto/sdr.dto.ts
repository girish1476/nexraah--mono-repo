import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export const SDR_KINDS = ['SHORTAGE', 'DAMAGE', 'UNLOADING_ACK'] as const;
export type SdrKind = (typeof SDR_KINDS)[number];

export class ResolveSdrDto {
  /** What to take from the transporter. 0 dismisses the record. */
  @IsInt() @Min(0) deductionPaise!: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
