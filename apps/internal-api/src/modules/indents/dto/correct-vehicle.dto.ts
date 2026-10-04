import { IsString, MaxLength, MinLength } from 'class-validator';

/** `POST /indents/:id/vehicle-correction` — a mistyped truck number put right, with why. */
export class CorrectVehicleDto {
  @IsString() @MinLength(4) @MaxLength(20) vehicleNo!: string;
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
