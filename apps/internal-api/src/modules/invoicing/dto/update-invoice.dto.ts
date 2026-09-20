import { IsArray, IsDateString, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Every field optional — a partial update, not a resubmission of the whole
 * form. The service applies each one only when present and falls back to
 * the invoice's current value otherwise (part 08, editing an unpaid
 * invoice).
 *
 * `tripIds` and `freightPaise` travel together deliberately: the frontend
 * computes freight from the trips actually selected (the same trust model
 * `CreateInvoiceDto` uses), so a `tripIds` change with no matching
 * `freightPaise` is a client bug, not a partial update — the service
 * rejects that combination rather than silently keeping a stale freight
 * figure against a new trip selection.
 */
export class UpdateInvoiceDto {
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsDateString() invoiceDate?: string;
  @IsOptional() @IsDateString() dueDate?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tripIds?: string[];
  @IsOptional() @IsInt() @Min(0) freightPaise?: number;
  @IsOptional() @IsInt() @Min(0) loadingPaise?: number;
  @IsOptional() @IsInt() @Min(0) unloadingPaise?: number;
  @IsOptional() @IsInt() @Min(0) detentionPaise?: number;
  @IsOptional() @IsInt() @Min(0) otherPaise?: number;
  @IsOptional() @IsInt() @Min(0) discountPaise?: number;
  @IsOptional() @IsString() notes?: string;
}
