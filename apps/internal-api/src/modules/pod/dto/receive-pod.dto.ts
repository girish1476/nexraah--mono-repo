import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ReceivePodDto {
  @IsString() courierDocket!: string;
  @IsString() sentOn!: string;
  @IsString() receivedOn!: string;
  @IsOptional() @IsInt() @Min(1) pages?: number;
  @IsString() receivedBy!: string;
  @IsOptional() @IsString() condition?: string;
}
