import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { CHARGE_TYPES } from '../../trips/trips.constants';

class PodChargeDto {
  @IsIn(CHARGE_TYPES) chargeType!: string;
  @IsInt() @Min(0) costAmountPaise!: number;
  @IsInt() @Min(0) billedAmountPaise!: number;
}

/** docs/api/05-pod.md `POST /pod/:tripId/verify` — five-item clerical checklist. */
class PodChecklistDto {
  @IsBoolean() consigneeStamp!: boolean;
  @IsBoolean() signedAndDated!: boolean;
  @IsBoolean() lrNumberMatches!: boolean;
  @IsBoolean() quantityMatchesInvoice!: boolean;
  @IsBoolean() noShortageOrDamage!: boolean;
}

export class VerifyPodDto {
  @ValidateNested() @Type(() => PodChecklistDto) checklist!: PodChecklistDto;
  @IsOptional() @IsString() remarks?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PodChargeDto) charges?: PodChargeDto[];
}
