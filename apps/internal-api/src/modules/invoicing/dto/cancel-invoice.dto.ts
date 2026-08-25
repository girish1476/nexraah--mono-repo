import { IsString } from 'class-validator';

/** Length (≥20 chars) is enforced by `assertReason()` in the service — REASON_TOO_SHORT is the required error code. */
export class CancelInvoiceDto {
  @IsString() reason!: string;
}
