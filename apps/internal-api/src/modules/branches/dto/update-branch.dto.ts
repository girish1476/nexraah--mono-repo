import { IsIn, IsInt, IsOptional, IsString, Min, ValidateIf } from 'class-validator';
import { SUPPLY_SOURCES, type SupplySourceCode } from '../branches.constants';

export class UpdateBranchDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsInt() @Min(0) catchmentKm?: number;

  /** Explicit null clears the source back to "not recorded". */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(SUPPLY_SOURCES)
  supplySource?: SupplySourceCode | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  supplyRemarks?: string | null;
}
