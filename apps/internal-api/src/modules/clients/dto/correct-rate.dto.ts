import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * `PATCH /clients/:id/rate-card/:laneId` — an agreed rate typed wrongly, put
 * right at once. Every figure is optional; the reason is not, and is kept on
 * the lane.
 */
export class CorrectRateLaneDto {
  @IsOptional() @IsInt() @Min(1) ratePaise?: number;
  @IsOptional() @IsIn(['FTL', 'PMT']) rateBasis?: 'FTL' | 'PMT';
  @IsOptional() @IsInt() @Min(0) @Max(60) transitDays?: number;
  @IsOptional() @IsDateString() validFrom?: string;
  /** `null` makes the rate open-ended. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() validTo?: string | null;

  /** Checked in the service, so the refusal carries `REASON_TOO_SHORT` like a deletion's does. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/**
 * `PATCH /clients/:id/rate-card/pending/:approvalId` — a proposed lane still
 * waiting for sign-off, corrected where it waits. It stays waiting.
 */
export class EditPendingRateLaneDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) origin?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) destination?: string;
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) truckType?: string;
  @IsOptional() @IsInt() @Min(1) ratePaise?: number;
  @IsOptional() @IsIn(['FTL', 'PMT']) rateBasis?: 'FTL' | 'PMT';
  @IsOptional() @IsInt() @Min(0) @Max(60) transitDays?: number;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() validTo?: string | null;
}

/** `PATCH /clients/:id/rate-revisions/:revisionId` — a rate change still waiting for sign-off, corrected in place. */
export class EditPendingRateRevisionDto {
  @IsOptional() @IsInt() @Min(1) newRatePaise?: number;
  @IsOptional() @IsDateString() effectiveFrom?: string;
  @IsOptional() @IsString() @MinLength(20) @MaxLength(1000) reason?: string;
}
