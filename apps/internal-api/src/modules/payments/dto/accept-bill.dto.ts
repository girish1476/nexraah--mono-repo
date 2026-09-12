import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { ReleasePaymentDto } from './release-payment.dto';

/**
 * Accepting a bill releases the balance for its trip — BR-09's five mandatory
 * payment fields apply here exactly as they do to a direct balance release.
 */
export class AcceptBillDto extends ReleasePaymentDto {
  @IsOptional() @IsBoolean() atTheirFigure?: boolean;
  @IsOptional() @IsString() reason?: string;
}
