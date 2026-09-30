import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { CHARGE_TYPES } from '../../trips/trips.constants';
import { SDR_KINDS, type SdrKind } from '../../sdr/dto/sdr.dto';

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
  /**
   * When the proof shows a shortage or damage, the remarks become a shortage /
   * damage record (SDR) on the trip. These say which kind and what it is
   * believed to cost; both optional — the kind defaults from which check
   * failed, and the amount is fixed later, at resolution.
   */
  @IsOptional() @IsIn(SDR_KINDS as unknown as string[]) sdrKind?: SdrKind;
  @IsOptional() @IsInt() @Min(0) sdrClaimedAmountPaise?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PodChargeDto) charges?: PodChargeDto[];
}
