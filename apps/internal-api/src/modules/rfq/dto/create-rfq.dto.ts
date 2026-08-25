import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class CreateRfqDto {
  @IsString() clientId!: string;
  @IsIn([3, 6, 12]) cycleMonths!: number;
  @IsDateString() periodFrom!: string;
  @IsDateString() periodTo!: string;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsString() reference?: string;
}
