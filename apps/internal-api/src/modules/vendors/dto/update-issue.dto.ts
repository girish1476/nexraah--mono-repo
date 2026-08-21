import { IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateIssueDto {
  @IsOptional() @IsIn(['OPEN', 'IN_PROGRESS', 'RESOLVED']) status?: string;
  @IsOptional() @IsString() note?: string;
}
