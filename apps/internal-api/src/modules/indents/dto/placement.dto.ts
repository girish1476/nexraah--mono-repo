import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class PlacementDto {
  @IsString() vehicleNo!: string;
  @IsString() driverName!: string;
  @IsString() driverLicence!: string;
  @IsString() reportedAt!: string;
  // The frontend computes this for display; the server recomputes and is
  // authoritative (docs/api/03-clients-indents.md `POST /indents/:id/placement`).
  @IsOptional() @IsBoolean() transitDelay?: boolean;
  @IsOptional() @IsString() remarks?: string;
}
