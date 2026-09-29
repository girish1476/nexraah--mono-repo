import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class AddDocketDto {
  /** The courier's docket number — the proof the paper was sent. */
  @IsString() @MinLength(3) docketNo!: string;
  /** Defaults to today. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) sentOn?: string;
}
