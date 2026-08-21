import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PnlService } from './pnl.service';

/**
 * No @RequirePermission here: access is "pnl.view_all OR pnl.view_own",
 * which the single-code decorator can't express (part 01 §2.5 permissions
 * are a flat AND check) — PnlService checks both explicitly and throws
 * PERMISSION_DENIED itself when neither is held.
 */
@Controller('pnl')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class PnlController {
  constructor(private readonly pnlService: PnlService) {}

  @Get()
  pnl(
    @CurrentUser() user: AuthenticatedUser,
    @Query('granularity') granularity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branch') branch?: string,
  ) {
    return this.pnlService.pnl(user, { granularity, from, to, branch });
  }

  @Get('exceptions')
  exceptions(@CurrentUser() user: AuthenticatedUser) {
    return this.pnlService.exceptions(user);
  }
}
