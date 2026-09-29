import { IsIn, IsInt, IsOptional, IsPositive, IsString, Max, Min } from 'class-validator';

/** `POST /indents` — docs/api/03-clients-indents.md. */
export class CreateIndentDto {
  @IsString() clientId!: string;
  @IsString() fromCity!: string;
  @IsString() toCity!: string;
  @IsString() material!: string;
  // Tonnes on the wire, integer kg in the column. `docs/api/03-clients-indents.md`
  // specifies `weightTn` on the request, and every read path already answers in
  // tonnes (`indents.service.ts` divides by 1000). Declaring `weightKg` here made
  // the global `ValidationPipe({ whitelist: true })` strip the tonnes the console
  // actually sends, so creation failed on a missing required field.
  @IsPositive() weightTn!: number;
  @IsString() truckType!: string;
  @IsString() pickupDate!: string;

  @IsOptional() @IsInt() @Min(0) transitDays?: number;
  @IsOptional() @IsIn(['SAME_DAY', 'NEXT_DAY', 'SCHEDULED']) reportingRule?: string;
  @IsOptional() @IsString() remarks?: string;

  @IsIn(['CONTRACT', 'SPOT']) rateSource!: 'CONTRACT' | 'SPOT';
  @IsPositive() sellRatePaise!: number;

  // SPOT only — BR-26, BR-38.
  @IsOptional() @IsPositive() sourcingRatePaise?: number;
  @IsOptional() @IsString() spotConfirmationAttachmentId?: string;
  // CONTRACT only — which won rate-card lane this indent draws from.
  @IsOptional() @IsString() rateCardLaneId?: string;

  // No bid band here. It is a term of the client's rate, held on the rate-card
  // lane and copied onto the indent by the server; changing it is a Leadership
  // decision (`LANE_BAND_CHANGE`), not something the person raising an indent
  // can type.

  // Optional per-order override. Absent means the awarded vendor's standing
  // policy applies (BR-30); present means this order asked for its own figure.
  @IsOptional() @IsInt() @Min(0) @Max(100) advancePct?: number;
}
