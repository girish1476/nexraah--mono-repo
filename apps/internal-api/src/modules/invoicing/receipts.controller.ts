import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { InvoicingService } from './invoicing.service';
import { RecordReceiptDto } from './dto/record-receipt.dto';

@Controller('receipts')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ReceiptsController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Post()
  @RequirePermission('receipt.record')
  record(@Body() dto: RecordReceiptDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.recordReceipt(dto, user);
  }
}
