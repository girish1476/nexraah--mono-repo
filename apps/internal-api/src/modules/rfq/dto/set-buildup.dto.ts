import { IsInt } from 'class-validator';

export class SetBuildupDto {
  @IsInt() overheadPaise!: number; // rfq_lanes.overhead check (>= 0)
  @IsInt() marginPaise!: number; // no >= 0 check — a loss-leader quote is legal
}
