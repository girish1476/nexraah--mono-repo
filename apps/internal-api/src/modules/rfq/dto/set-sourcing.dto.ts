import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateIf, ValidateNested } from 'class-validator';
import { SUPPLY_SOURCES, type SupplySourceCode } from '../../branches/branches.constants';

class SourcingRowDto {
  /** `YYYY-MM` for MONTHLY; omitted/null for the two HIGH_LOW rows. */
  @IsOptional() @IsString() month?: string | null;
  @IsInt() @Min(0) ratePaise!: number;
}

export class SetSourcingDto {
  @IsIn(['MONTHLY', 'HIGH_LOW']) sourcingMode!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => SourcingRowDto) sourcingRows!: SourcingRowDto[];

  /**
   * Sourcing is where the operator finds out whether the trucks came off the
   * union board or the open market, so the lane's supply source is recorded
   * here rather than in a separate call. Omit to leave whatever is on the lane
   * untouched; send explicit null to clear it back to "not recorded".
   */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(SUPPLY_SOURCES)
  supplySource?: SupplySourceCode | null;

  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString()
  supplyRemarks?: string | null;
}
