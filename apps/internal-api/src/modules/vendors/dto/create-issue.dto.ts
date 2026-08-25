import { IsIn, IsOptional, IsString } from 'class-validator';

export class CreateIssueDto {
  @IsString() vendorId!: string;
  @IsString() category!: string;
  @IsIn(['LOW', 'MEDIUM', 'HIGH']) severity!: 'LOW' | 'MEDIUM' | 'HIGH';
  // The operator has the trip's human-readable code on hand, not its id —
  // the service resolves it (404s on an unknown code).
  @IsOptional() @IsString() tripCode?: string;
  @IsOptional() @IsString() note?: string;
}
