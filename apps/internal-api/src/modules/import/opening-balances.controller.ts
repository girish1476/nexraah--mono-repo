import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ImportService } from './import.service';
import { SettleOpeningBalanceDto } from './dto/settle-opening-balance.dto';

/**
 * Opening balances carried in at go-live (part 12) — what was owed on the day
 * Nexraah took over, and whether it has been settled since. Shown on the
 * receivables page; settling one needs `receipt.record` for a client balance
 * and `payment.release` for a transporter advance, checked in the service
 * because which one applies depends on the row.
 */
@Controller('opening-balances')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class OpeningBalancesController {
  constructor(private readonly importService: ImportService) {}

  @Get()
  list() {
    return this.importService.openingBalances();
  }

  @Post(':id/settle')
  settle(
    @Param('id') id: string,
    @Body() body: SettleOpeningBalanceDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importService.settleOpeningBalance(id, body.note, user);
  }
}
