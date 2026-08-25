import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { SUPPLY_SOURCES, type SupplySourceCode } from '../branches.constants';

export class CreateBranchDto {
  @IsString() name!: string;
  @IsString() city!: string;

  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(0) catchmentKm?: number;

  @IsOptional() @IsIn(SUPPLY_SOURCES) supplySource?: SupplySourceCode;
  @IsOptional() @IsString() supplyRemarks?: string;
}
