import { Body, Controller, Headers, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DomainException } from '../../common/domain-exception';
import { InvoicingService } from './invoicing.service';
import { RecordReceiptDto } from './dto/record-receipt.dto';

@Controller('receipts')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ReceiptsController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Post()
  @RequirePermission('receipt.record')
  record(
    @Body() dto: RecordReceiptDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return this.invoicingService.recordReceipt(dto, idempotencyKey, user);
  }

  private assertIdempotencyKey(key: string | undefined): asserts key is string {
    if (!key) {
      throw new DomainException(400, 'IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required.');
    }
  }
}
