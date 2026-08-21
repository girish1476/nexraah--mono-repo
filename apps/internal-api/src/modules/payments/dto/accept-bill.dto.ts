import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class AcceptBillDto {
  @IsOptional() @IsBoolean() atTheirFigure?: boolean;
  @IsOptional() @IsString() reason?: string;
}
