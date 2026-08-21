import { IsString, MinLength } from 'class-validator';

export class CrossCheckOverrideDto {
  @IsString() @MinLength(20) reason!: string;
}
