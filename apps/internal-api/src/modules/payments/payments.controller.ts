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
// Reading a gate is not releasing money. `indent.view` is held by every desk
// that works a trip — Ops, Compliance, Finance, Branch Manager, Leadership.
const READ_GATE = 'indent.view';

// BR-40: RELEASING money is FINANCE-only, no exceptions — so `payment.release`
// sits on each mutating handler rather than on the class.
//
// It used to sit on the class, which meant the read-only gate views needed
// Finance too. That silently contradicted the module matrix: Compliance is
// granted payments access precisely so it can see whether the advance
// documents it verifies have cleared, and Ops owns the trip those documents
// hang off. Both desks got "Missing permission: payment.release" on the advance
// panel of the trip page — the one screen that tells them what is still
// blocking the money they are being asked to unblock.
//
// Reads take `indent.view`; every write below still takes `payment.release`.
@Controller('payments')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('advance')
  @RequirePermission(READ_GATE)
  advanceQueue(@Query('status') status?: string) {
    return this.paymentsService.advanceQueue(status);
  }

  @Get('advance/:ref')
  @RequirePermission(READ_GATE)
  advanceGate(@Param('ref') ref: string) {
    return this.paymentsService.advanceGate(ref);
  }

  @Post('advance/:ref')
  @RequirePermission(PAYMENT_RELEASE)
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
  @RequirePermission(READ_GATE)
  balanceQueue() {
    return this.paymentsService.balanceQueue();
  }

  @Get('balance/:tripId')
  @RequirePermission(READ_GATE)
  balanceGate(@Param('tripId') tripId: string) {
    return this.paymentsService.balanceGate(tripId);
  }

  @Post('balance/:tripId')
  @RequirePermission(PAYMENT_RELEASE)
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
  @RequirePermission(READ_GATE)
  listBills(@Query('status') status?: string) {
    return this.paymentsService.listBills(status);
  }

  @Get('bills/:id')
  @RequirePermission(READ_GATE)
  getBill(@Param('id') id: string) {
    return this.paymentsService.getBill(id);
  }

  @Post('bills/:id/accept')
  @RequirePermission(PAYMENT_RELEASE)
  acceptBill(
    @Param('id') id: string,
    @Body() dto: AcceptBillDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    this.assertIdempotencyKey(idempotencyKey);
    return this.paymentsService.acceptBill(id, dto, idempotencyKey as string, user);
  }

  @Post('bills/:id/query')
  @RequirePermission(PAYMENT_RELEASE)
  queryBill(@Param('id') id: string, @Body() dto: QueryBillDto, @CurrentUser() user: AuthenticatedUser) {
    return this.paymentsService.queryBill(id, dto.note, user);
  }

  private assertIdempotencyKey(key: string | undefined): asserts key is string {
    if (!key) {
      throw new DomainException(400, 'IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required.');
    }
  }
}
