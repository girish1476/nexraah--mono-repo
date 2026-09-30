import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';

export class PlacementDto {
  @IsString() vehicleNo!: string;
  // The one contact detail allocation needs — Operations reaches the truck by
  // phoning its driver. Ten digits, an optional +91 / 0 prefix tolerated.
  @Matches(/^(\+91|0)?[6-9]\d{9}$/, { message: 'Enter the driver’s 10-digit mobile number.' })
  driverPhone!: string;
  // Often unknown when the vehicle is confirmed; the licence is checked later
  // with the advance documents.
  @IsOptional() @IsString() driverName?: string;
  @IsOptional() @IsString() driverLicence?: string;
  @IsString() reportedAt!: string;
  // The frontend computes this for display; the server recomputes and is
  // authoritative (docs/api/03-clients-indents.md `POST /indents/:id/placement`).
  @IsOptional() @IsBoolean() transitDelay?: boolean;
  @IsOptional() @IsString() remarks?: string;
}
