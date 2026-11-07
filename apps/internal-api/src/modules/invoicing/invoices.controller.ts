import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { InvoicingService } from './invoicing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { CancelInvoiceDto } from './dto/cancel-invoice.dto';
import { ManualInvoiceBulkDto, ManualInvoiceDto } from './dto/manual-invoice.dto';

const INVOICE_CREATE = 'invoice.create';

@Controller('invoices')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class InvoicesController {
  constructor(private readonly invoicingService: InvoicingService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.invoicingService.list({ q, status, from, to });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.invoicingService.getById(id);
  }

  @Post()
  @RequirePermission(INVOICE_CREATE)
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.create(dto, user);
  }

  // Built by hand — administrators only; the service checks the role too.
  @Post('manual')
  @RequirePermission(INVOICE_CREATE)
  createManual(@Body() dto: ManualInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.createManual(dto, user);
  }

  @Post('manual/bulk')
  @RequirePermission(INVOICE_CREATE)
  createManualBulk(@Body() dto: ManualInvoiceBulkDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.createManualBulk(dto, user);
  }

  @Patch('manual/:id')
  @RequirePermission(INVOICE_CREATE)
  updateManual(@Param('id') id: string, @Body() dto: ManualInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.updateManual(id, dto, user);
  }

  @Patch(':id')
  @RequirePermission(INVOICE_CREATE)
  update(@Param('id') id: string, @Body() dto: UpdateInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.update(id, dto, user);
  }

  @Post(':id/generate')
  @RequirePermission(INVOICE_CREATE)
  generate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.generate(id, user);
  }

  @Post(':id/cancel')
  @RequirePermission(INVOICE_CREATE)
  cancel(@Param('id') id: string, @Body() dto: CancelInvoiceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.invoicingService.cancel(id, dto, user);
  }
}
