import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

/** `PATCH /indents/:id/advance-pct` — BR-57, always raises `ADVANCE_POLICY_CHANGE` when it departs from the vendor's standing policy. */
export class AdvancePctDto {
  @IsInt() @Min(0) @Max(100) advancePct!: number;
  @IsString() @MinLength(20) reason!: string;
}
