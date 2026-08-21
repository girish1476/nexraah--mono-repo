import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

/** `PATCH /vendors/:id/advance-policy` — BR-57, always raises `ADVANCE_POLICY_CHANGE`. */
export class AdvancePolicyDto {
  @IsInt() @Min(0) @Max(100) advancePct!: number;
  @IsString() @MinLength(20) reason!: string;
}
