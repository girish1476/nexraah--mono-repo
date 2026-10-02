import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * The milestones a truck passes, in order, plus a plain position update.
 * `DEPARTED` and `UNLOADED` are written by the depart and deliver actions
 * themselves, so they are not posted here.
 */
export const TRACKING_KINDS = ['UPDATE', 'REACHED_LOADING', 'LOADED', 'REACHED'] as const;
export type PostedTrackingKind = (typeof TRACKING_KINDS)[number];

/** `POST /trips/:id/tracking` — one line on the trip's tracking sheet. */
export class AddTrackingDto {
  @IsIn(TRACKING_KINDS as unknown as string[]) kind!: PostedTrackingKind;

  /** Where the truck is — a city, a toll plaza, a landmark. Required for a plain update. */
  @IsOptional() @IsString() @MinLength(2) @MaxLength(200) location?: string;

  @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;

  @IsOptional() @IsString() @MaxLength(500) note?: string;

  /** How the truck is doing — moving, halted, at a checkpost, broken down… */
  @IsOptional() @IsIn(['MOVING', 'HALTED', 'CHECKPOST', 'TRAFFIC', 'BREAKDOWN', 'ACCIDENT', 'WAITING_TO_UNLOAD', 'OTHER']) status?: string;

  /** When it happened; now when left out. */
  @IsOptional() @IsDateString() at?: string;
}

/** How the truck is doing at a position update. */
export const TRACKING_STATUSES = ['MOVING', 'HALTED', 'CHECKPOST', 'TRAFFIC', 'BREAKDOWN', 'ACCIDENT', 'WAITING_TO_UNLOAD', 'OTHER'] as const;

/**
 * `POST /trips/:id/eway-extension` — the e-way bill extended while the truck
 * is still on the road. The same paper, valid for longer; optionally the
 * extension's own number.
 */
export class ExtendEwayDto {
  @IsDateString() validTill!: string;
  @IsOptional() @IsString() @MaxLength(40) ewayNo?: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
