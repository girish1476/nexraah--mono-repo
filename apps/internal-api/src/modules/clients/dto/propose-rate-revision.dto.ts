import { IsDateString, IsInt, IsString, IsUUID, Min, MinLength } from 'class-validator';

export class ProposeRateRevisionDto {
  /** The lane in force whose rate is changing — not the client, not the route. */
  @IsUUID() laneId!: string;

  /** Paise, like every other money field in this API. `> 0` matches the column check. */
  @IsInt() @Min(1) newRatePaise!: number;

  /**
   * The day the new rate starts. Refused if it is in the past — a backdated
   * rate silently re-prices loads already raised and already invoiced
   * (`rate-revision.ts`).
   */
  @IsDateString() effectiveFrom!: string;

  /**
   * 20 characters, matching the approvals engine's own `REASON_TOO_SHORT`
   * floor. Validated here as well as there so the caller is told at the point
   * of the mistake rather than after the lane lookup.
   */
  @IsString() @MinLength(20) reason!: string;
}
