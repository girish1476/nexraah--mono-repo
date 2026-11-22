import { IsString } from 'class-validator';

/** How an opening balance was settled. Length (5 or more characters) is checked in the service. */
export class SettleOpeningBalanceDto {
  @IsString() note!: string;
}
