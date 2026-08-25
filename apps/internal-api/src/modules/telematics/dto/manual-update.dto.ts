import { IsArray, IsIn, IsInt, IsISO8601, IsLatitude, IsLongitude, IsOptional, Max, Min } from 'class-validator';
import { ALERT_KINDS, AlertKind } from '../telematics.constants';

/**
 * `PATCH /telematics/vehicles/:vehicleNo` body — the fleet board's "Update"
 * action. No GPS provider is wired up, so Ops keys in what the driver or
 * transporter said on the phone. Every field is optional: what is omitted
 * keeps the vehicle's last known value.
 *
 * `ewayValidTill: null` explicitly clears the e-way bill on the open trip;
 * omitting it leaves the trip untouched.
 */
export class ManualUpdateDto {
  @IsOptional() @IsInt() @Min(0) @Max(300) speedKmph?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) fuelPct?: number;

  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;

  // `@IsOptional` also lets `null` through untouched — that is the "clear it" signal.
  @IsOptional() @IsISO8601() ewayValidTill?: string | null;

  /** Alerts Ops asserts by hand; they stay on the board while this update is the latest word on the vehicle. */
  @IsOptional() @IsArray() @IsIn(ALERT_KINDS, { each: true }) alerts?: AlertKind[];
}
