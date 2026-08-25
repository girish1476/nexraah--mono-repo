import { IsISO8601, IsOptional } from 'class-validator';

export class DeliverTripDto {
  @IsOptional() @IsISO8601() deliveredAt?: string;
}
