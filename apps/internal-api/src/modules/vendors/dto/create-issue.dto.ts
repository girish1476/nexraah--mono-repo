import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateIssueDto {
  @IsString() vendorId!: string;
  @IsString() category!: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH']) severity!: 'LOW' | 'MEDIUM' | 'HIGH';
  @IsOptional() @IsString() tripId?: string;
  @IsOptional() @IsString() note?: string;
}
