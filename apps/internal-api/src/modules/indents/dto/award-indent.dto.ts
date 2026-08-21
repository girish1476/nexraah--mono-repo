import { IsOptional, IsString } from 'class-validator';

export class AwardIndentDto {
  @IsString() quoteId!: string;
  @IsOptional() @IsString() reason?: string;
}
