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

  /** When it happened; now when left out. */
  @IsOptional() @IsDateString() at?: string;
}
