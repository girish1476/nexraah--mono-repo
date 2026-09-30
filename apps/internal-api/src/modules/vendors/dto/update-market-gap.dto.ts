import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

/** A change to one row. Each count is optional; whichever is sent is set. */
export class UpdateMarketGapDto {
  @IsOptional() @IsInt() @Min(0) target?: number;
  @IsOptional() @IsInt() @Min(0) onPanel?: number;
  @IsOptional() @IsInt() @Min(0) converted?: number;
}

/** A lane where the panel is thin, recorded by hand. */
export class CreateMarketGapDto {
  @IsUUID() branchId!: string;
  @IsString() @MinLength(3) @MaxLength(120) lane!: string;
  @IsString() @MinLength(2) @MaxLength(60) truckType!: string;
  @IsInt() @Min(0) target!: number;
  @IsOptional() @IsInt() @Min(0) onPanel?: number;
  @IsOptional() @IsInt() @Min(0) converted?: number;
}
