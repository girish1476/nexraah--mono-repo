import { IsIn, IsInt, IsString, Min } from 'class-validator';

export class AddLaneDto {
  @IsString() origin!: string;
  @IsString() destination!: string;
  @IsString() truckType!: string;
  @IsInt() @Min(0) transitDays!: number;
  @IsIn(['SAME_DAY', 'NEXT_DAY', 'SCHEDULED']) reportingRule!: string;
}
