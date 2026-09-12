import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ReceivePodDto {
  @IsString() courierDocket!: string;
  @IsString() sentOn!: string;
  @IsString() receivedOn!: string;
  @IsOptional() @IsInt() @Min(1) pages?: number;
  /**
   * Who signed for the courier. Optional: the receiving register has no
   * field for it, so the service records the signed-in user — the person
   * logging the docket is the one holding the envelope. Required here meant
   * every receipt logged from the console was refused.
   */
  @IsOptional() @IsString() receivedBy?: string;
  @IsOptional() @IsString() condition?: string;
}
