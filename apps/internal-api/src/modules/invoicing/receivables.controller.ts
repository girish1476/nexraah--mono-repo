import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { InvoicingService } from './invoicing.service';

@Controller('receivables')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ReceivablesController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Get()
  get(@Query('ageing') ageing?: string, @Query('client') client?: string) {
    return this.invoicingService.receivables({ ageing, client });
  }
}
