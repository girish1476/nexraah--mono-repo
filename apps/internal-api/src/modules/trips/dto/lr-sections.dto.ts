import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { FORMAT_MESSAGE, GSTIN_SHAPE_RE, PHONE_RE, VEHICLE_RE } from '../../../common/validation/formats';

/**
 * The sections of a lorry receipt, validated.
 *
 * These replace seven `@IsObject()` declarations on `PatchLrDto`. That is not
 * a small distinction: `@IsObject()` asserts "this is an object" and nothing
 * else, so every field of the consignment note — the names of the consignor
 * and consignee, the goods, the invoice value, the e-way bill, the vehicle,
 * the driver — reached the database entirely unchecked.
 *
 * It matters more here than anywhere else in the app because the LR **is the
 * contract of carriage**. The schema itself says so, and only manages to
 * enforce two keys (`lr_consignor_named`, `lr_consignee_named`); its own
 * comment concedes that "a jsonb column with no shape is a text column with
 * extra steps".
 *
 * Optionality mirrors the table: `consignor`, `consignee`, `goods`, `vehicle`
 * and `driver` are `not null` there, `invoice` and `eway` are nullable. Within
 * a section, only the fields the printed document is not legal without are
 * required — the rest are genuinely optional and stay so, because an LR is
 * often typed up before every detail is known.
 */

export class LrPartyDto {
  /** The one field the schema's own check constraint demands. */
  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional() @IsString() @MaxLength(400) address?: string;

  @IsOptional()
  @Matches(GSTIN_SHAPE_RE, { message: FORMAT_MESSAGE.gstin })
  gstin?: string;
}

export class LrGoodsDto {
  @IsOptional() @IsString() @MaxLength(400) description?: string;

  @IsOptional() @IsInt() @Min(0) packages?: number;

  /** Tonnes, so a decimal — unlike the paise fields, which are integers. */
  @IsOptional() @IsNumber() @Min(0) weightTn?: number;

  @IsOptional() @IsInt() @Min(0) valuePaise?: number;
}

export class LrInvoiceDto {
  @IsOptional() @IsString() @MaxLength(60) number?: string;

  @IsOptional() @IsDateString() datedOn?: string;

  @IsOptional() @IsInt() @Min(0) valuePaise?: number;
}

export class LrEwayDto {
  /** An e-way bill number is twelve digits. */
  @IsOptional()
  @Matches(/^\d{12}$/, { message: 'An e-way bill number is twelve digits.' })
  number?: string;

  @IsOptional() @IsDateString() validTill?: string;
}

export class LrVehicleDto {
  @IsOptional()
  @Matches(VEHICLE_RE, { message: FORMAT_MESSAGE.vehicle })
  registration?: string;

  @IsOptional() @IsString() @MaxLength(60) type?: string;
}

export class LrDriverDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;

  @IsOptional() @IsString() @MaxLength(40) licence?: string;

  @IsOptional()
  @Matches(PHONE_RE, { message: FORMAT_MESSAGE.phone })
  phone?: string;
}

/**
 * Money on the LR, in paise.
 *
 * Every head is an integer ≥ 0 including `discountPaise` — a discount is
 * recorded as a positive amount that is subtracted, not as a negative charge,
 * so a negative here would flip the sign of the total. That was previously
 * unconstrained in both directions.
 */
export class LrChargeHeadsDto {
  @IsOptional() @IsInt() @Min(0) freightPaise?: number;
  @IsOptional() @IsInt() @Min(0) loadingPaise?: number;
  @IsOptional() @IsInt() @Min(0) unloadingPaise?: number;
  @IsOptional() @IsInt() @Min(0) detentionPaise?: number;
  @IsOptional() @IsInt() @Min(0) otherPaise?: number;
  @IsOptional() @IsInt() @Min(0) discountPaise?: number;
}

