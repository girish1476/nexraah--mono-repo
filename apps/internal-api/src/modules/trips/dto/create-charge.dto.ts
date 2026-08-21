import { IsIn, IsInt, Min } from 'class-validator';
import { CHARGE_TYPES } from '../trips.constants';

export class CreateChargeDto {
  @IsIn(CHARGE_TYPES) chargeType!: string;
  @IsInt() @Min(0) costAmountPaise!: number;
  @IsInt() @Min(0) billedAmountPaise!: number;
}
