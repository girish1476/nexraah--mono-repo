import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DomainException } from '../../common/domain-exception';
import { PaymentsService } from './payments.service';
import { ReleasePaymentDto } from './dto/release-payment.dto';
import { AcceptBillDto } from './dto/accept-bill.dto';
import { QueryBillDto } from './dto/query-bill.dto';

const PAYMENT_RELEASE = 'payment.release'; // fixed to FINANCE — BR-40, permission_fixed_owners

// BR-40: every route here is FINANCE-only, no exceptions.
@Controller('payments')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
@RequirePermission(PAYMENT_RELEASE)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('advance')
  advanceQueue(@Query('status') status?: string) {
    return this.paymentsService.advanceQueue(status);
  }

  @Get('advance/:ref')
  advanceGate(@Param('ref') ref: string) {
    return this.paymentsService.advanceGate(ref);
  }

  @Post('advance/:ref')
  releaseAdvance(
    @Param('ref') ref: string,
    @Body() dto: ReleasePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return this.paymentsService.releaseAdvance(ref, dto, idempotencyKey as string, user);
  }

  @Get('balance')
  balanceQueue() {
    return this.paymentsService.balanceQueue();
  }

  @Get('balance/:tripId')
  balanceGate(@Param('tripId') tripId: string) {
    return this.paymentsService.balanceGate(tripId);
  }

  @Post('balance/:tripId')
  releaseBalance(
    @Param('tripId') tripId: string,
    @Body() dto: ReleasePaymentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return this.paymentsService.releaseBalance(tripId, dto, idempotencyKey as string, user);
  }

  @Get('bills')
  listBills(@Query('status') status?: string) {
    return this.paymentsService.listBills(status);
  }

  @Post('bills/:id/accept')
  acceptBill(@Param('id') id: string, @Body() dto: AcceptBillDto, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.acceptBill(id, dto, user);
  }

  @Post('bills/:id/query')
  queryBill(@Param('id') id: string, @Body() dto: QueryBillDto, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.queryBill(id, dto.note, user);
  }

  private assertIdempotencyKey(key: string | undefined): asserts key is string {
    if (!key) {
      throw new DomainException(400, 'IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required.');
    }
  }
}
