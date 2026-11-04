import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { SUPPLY_SOURCES, type SupplySourceCode } from '../branches.constants';

export class CreateBranchDto {
  @IsString() name!: string;
  @IsString() city!: string;

  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsInt() @Min(0) catchmentKm?: number;

  /** Towns this branch also serves (BR-20) — the whole list, replacing what was there. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @MaxLength(80, { each: true })
  servedCities?: string[];

  @IsOptional() @IsIn(SUPPLY_SOURCES) supplySource?: SupplySourceCode;
  @IsOptional() @IsString() supplyRemarks?: string;
}
