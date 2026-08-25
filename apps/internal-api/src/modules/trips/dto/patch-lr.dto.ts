import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  LrChargeHeadsDto,
  LrDriverDto,
  LrEwayDto,
  LrGoodsDto,
  LrInvoiceDto,
  LrPartyDto,
  LrVehicleDto,
} from './lr-sections.dto';

/**
 * `PATCH /trips/:id/lr` — draft autosave, every 3 seconds. Each provided key
 * replaces that section wholesale.
 *
 * Every section used to be declared `@IsObject()`, which asserts that a value
 * is an object and checks nothing inside it. On the document that is the
 * contract of carriage, that meant the consignor's name, the goods, the
 * invoice value, the e-way bill, the vehicle and the driver all reached the
 * database unvalidated. `@ValidateNested()` with an explicit `@Type()` is what
 * makes the section classes actually run.
 *
 * `@Type()` is required, not decorative: without it `class-transformer` leaves
 * the incoming value as a plain object, `ValidateNested` has no class to
 * validate against, and the whole thing quietly passes — the same shape of
 * failure as the missing `forbidNonWhitelisted`, where the guard is present
 * but inert.
 *
 * Because the autosave replaces a section wholesale, validating a section
 * validates what will be stored. There is no merge in which a bad field could
 * survive from an earlier draft.
 */
export class PatchLrDto {
  @IsOptional() @ValidateNested() @Type(() => LrPartyDto) consignor?: LrPartyDto;
  @IsOptional() @ValidateNested() @Type(() => LrPartyDto) consignee?: LrPartyDto;
  @IsOptional() @ValidateNested() @Type(() => LrGoodsDto) goods?: LrGoodsDto;
  @IsOptional() @ValidateNested() @Type(() => LrInvoiceDto) invoice?: LrInvoiceDto;
  @IsOptional() @ValidateNested() @Type(() => LrEwayDto) eway?: LrEwayDto;
  @IsOptional() @ValidateNested() @Type(() => LrVehicleDto) vehicle?: LrVehicleDto;
  @IsOptional() @ValidateNested() @Type(() => LrDriverDto) driver?: LrDriverDto;

  @IsOptional() @IsInt() @Min(0) transitDays?: number;

  @IsOptional() @IsString() @MaxLength(1000) remarks?: string;

  @IsOptional() @ValidateNested() @Type(() => LrChargeHeadsDto) chargeHeads?: LrChargeHeadsDto;
}
