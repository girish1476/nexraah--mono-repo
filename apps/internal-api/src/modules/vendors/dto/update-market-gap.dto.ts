import { IsInt, Min } from 'class-validator';

export class UpdateMarketGapDto {
  @IsInt() @Min(0) target!: number;
}
