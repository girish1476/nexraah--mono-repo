import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength, ValidateIf } from 'class-validator';

/** `POST /clients/:id/rate-card` — a lane agreed outside an RFQ. Paise, like every money field here. */
export class AddRateLaneDto {
  @IsString() @MinLength(2) origin!: string;
  @IsString() @MinLength(2) destination!: string;
  @IsString() @MinLength(2) truckType!: string;

  /** The agreed lane rate. `> 0` matches the column check. */
  @IsInt() @Min(1) ratePaise!: number;

  /**
   * FTL — the rate is for the whole truck. PMT — per metric tonne, so a load is
   * priced at rate x weight. Some clients agree one, some the other.
   */
  @IsOptional() @IsIn(['FTL', 'PMT']) rateBasis?: 'FTL' | 'PMT';

  /** Days the client expects the load to take. Required: an indent copies it from the lane. */
  @IsInt() @Min(0) @Max(60) transitDays!: number;

  /**
   * Whether a late delivery on this lane is charged to the transporter. It varies
   * with the client, the route and the truck type, so it is decided here, when
   * the rate is entered.
   */
  @IsBoolean() transitPenaltyApplies!: boolean;

  /** What one late day costs, in paise. Required — and above zero — when the penalty applies. */
  @ValidateIf((o) => o.transitPenaltyApplies === true)
  @IsInt()
  @Min(1)
  transitPenaltyPerDayPaise?: number;

  /**
   * The subject line of the mail in which BD and Leadership agreed this rate.
   * Compliance signs the rate off against it, so it is not optional.
   */
  @IsString() @MinLength(5) approvalMailSubject!: string;

  /** A screenshot of that mail, uploaded through `/attachments`, when there is one. */
  @IsOptional() @IsUUID() approvalMailAttachmentId?: string;

  @IsDateString() validFrom!: string;

  /** Open-ended when left out — the lane runs until it is revised. */
  @IsOptional() @IsDateString() validTo?: string;

  /**
   * Where this rate was agreed (the contract clause, the email, the call).
   * 20 characters, matching the approvals engine's own floor, so the person
   * signing it off is not asked to approve a number with no source.
   */
  @IsString() @MinLength(20) reason!: string;
}
