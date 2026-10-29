import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DomainException } from '../../common/domain-exception';
import { journalLines } from '../../common/accounting-journal';
import { AccountingRepository } from './accounting.repository';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The two finance integrations that need no outside account (FSD B7):
 * `GET /accounting/journal` for the books, `GET /payments/released` for the
 * bank-statement check. Both read only; both are money everyone in Finance
 * already sees on the payment screens.
 */
@Controller()
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class AccountingController {
  constructor(private readonly repository: AccountingRepository) {}

  /** `?from=YYYY-MM-DD&to=YYYY-MM-DD` — every issued invoice, receipt and released payment in those days, as journal lines. */
  @Get('accounting/journal')
  @RequirePermission('pnl.view_all')
  async journal(@Query('from') from?: string, @Query('to') to?: string) {
    if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'Give the first and last day, the first not after the last.');
    }
    const [invoices, receipts, payments] = await Promise.all([
      this.repository.invoices(from, to),
      this.repository.receipts(from, to),
      this.repository.releasedPayments(from, to),
    ]);
    return journalLines({ invoices, receipts, payments }, from, to);
  }

  /** Every payment released to a transporter, with its UTR — what the bank statement is checked against. */
  @Get('payments/released')
  @RequirePermission('payment.release')
  released() {
    return this.repository.releasedPayments();
  }
}
