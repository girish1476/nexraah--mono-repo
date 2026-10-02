import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
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

/** The details read off the proof and typed in against it — like any other document. */
class PodDetailsDto {
  @IsOptional() @IsString() @MaxLength(120) receivedByName?: string;
  @IsOptional() @IsString() @MaxLength(120) quantityReceived?: string;
}

/** A shortage or a damage found on the proof. Each one becomes its own SDR. */
class PodFindingDto {
  @IsIn(['SHORTAGE', 'DAMAGE']) kind!: 'SHORTAGE' | 'DAMAGE';
  @IsString() @MaxLength(1000) description!: string;
  @IsOptional() @IsInt() @Min(0) claimedAmountPaise?: number;
}

/**
 * What a check of a proof of delivery can record, beyond "it is fine": the
 * details on it, shortages and damages, charges written on it, and a corrected
 * delivery date (which re-works the transit delay). Shared by the check of an
 * E-POD or H-POD (`verify`) and of the hard copy behind an E-POD
 * (`hard-copy/verify`).
 */
export class PodFindingsDto {
  @IsOptional() @ValidateNested() @Type(() => PodDetailsDto) details?: PodDetailsDto;
  /** The date the load was actually delivered, when the proof shows a different one. */
  @IsOptional() @IsDateString() deliveredOn?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(2) @ValidateNested({ each: true }) @Type(() => PodFindingDto) findings?: PodFindingDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PodChargeDto) charges?: PodChargeDto[];
  @IsOptional() @IsString() @MaxLength(1000) remarks?: string;
}

export class VerifyPodDto extends PodFindingsDto {
  @ValidateNested() @Type(() => PodChecklistDto) checklist!: PodChecklistDto;
  /**
   * Older callers: when the checklist shows a shortage or damage and no
   * `findings` are sent, the remarks become one SDR of this kind.
   */
  @IsOptional() @IsIn(SDR_KINDS as unknown as string[]) sdrKind?: SdrKind;
  @IsOptional() @IsInt() @Min(0) sdrClaimedAmountPaise?: number;
}
