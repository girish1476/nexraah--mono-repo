import { IsString, MinLength } from 'class-validator';

export class QueryBillDto {
  @IsString() @MinLength(1) note!: string;
}
