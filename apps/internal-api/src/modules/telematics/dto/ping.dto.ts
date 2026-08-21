import { IsISO8601, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * `POST /telematics/ping` body — docs/api/10-telematics-import.md. The
 * provider's own field names aren't standardized across vendors; this is
 * the shape *our* webhook expects, matching `telematics_pings`' columns.
 */
export class PingDto {
  @IsString() vehicleNo!: string;

  @IsISO8601() at!: string;

  @IsOptional() @IsLatitude() lat?: number;
  @IsOptional() @IsLongitude() lng?: number;

  @IsOptional() @IsInt() @Min(0) @Max(300) speedKmph?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100) fuelPct?: number;
}
