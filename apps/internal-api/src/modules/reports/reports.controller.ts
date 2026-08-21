import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('today')
  @RequirePermission('indent.view')
  today(@CurrentUser() user: AuthenticatedUser) {
    // part 09: BRANCH_MGR sees only their own branch; `branch` is null for
    // every other role (part 01), so this naturally scopes only that role.
    return this.reportsService.today(user.branch?.id ?? null);
  }

  // No @RequirePermission: no named permission code covers "Home" in the
  // seeded set (part 01 §2.4) — same footing as GET /branches and the GET
  // half of /config. Every authenticated internal principal may view it;
  // branch scoping still applies below regardless of role.
  @Get('home')
  home(@CurrentUser() user: AuthenticatedUser, @Query('month') month?: string) {
    return this.reportsService.home(user.branch?.id ?? null, month);
  }
}
