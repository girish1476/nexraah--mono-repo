import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class AwardDecisionDto {
  @IsString() laneId!: string;
  @IsIn(['WON', 'LOST', 'WITHDRAWN']) outcome!: string;
  @IsOptional() @IsInt() @Min(1) awardedRatePaise?: number;
}

export class AwardRfqDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AwardDecisionDto) lanes!: AwardDecisionDto[];
}
