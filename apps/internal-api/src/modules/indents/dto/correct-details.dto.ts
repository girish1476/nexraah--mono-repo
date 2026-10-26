import { IsDateString, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * `PATCH /indents/:id/details` — a load request put right. Every part is
 * optional: only what is sent is changed. The reason is not.
 */
export class CorrectIndentDetailsDto {
  @IsOptional() @IsString() @MaxLength(200) material?: string;
  /** Tonnes, as the console shows it; kept in kilograms. */
  @IsOptional() @IsNumber() @Min(0) @Max(200) weightTn?: number;
  @IsOptional() @IsString() @MaxLength(60) truckType?: string;
  @IsOptional() @IsDateString() pickupDate?: string;
  /** Paise, like every other money field in this API. */
  @IsOptional() @IsInt() @Min(1) sellRatePaise?: number;
  /** Empty clears it. */
  @IsOptional() @IsString() @MaxLength(500) pickupAddress?: string;
  @IsOptional() @IsString() @MaxLength(500) dropAddress?: string;

  /** Why it is being corrected — written to the order's comments. */
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

/** `PATCH /indents/:id/quotes/:quoteId` — a quote's amount put right, before or after the award. */
export class CorrectQuoteDto {
  @IsInt() @Min(1) amountPaise!: number;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}

/** `DELETE /indents/:id/quotes/:quoteId` — a quote entered by mistake, removed. */
export class RemoveQuoteDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
