import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ApprovalsService } from './approvals.service';
import { RejectApprovalDto } from './dto/reject-approval.dto';

@Controller('approvals')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  // No @RequirePermission: any internal role can see the inbox; the sidebar
  // badge filters client-side on `requiredPermission` (docs/api/01-foundation.md).
  @Get()
  list(@Query('status') status?: string, @Query('kind') kind?: string) {
    return this.approvalsService.list(status, kind);
  }

  // Permission depends on the row's `kind`, resolved inside the service —
  // see ApprovalsService.assertCanDecide.
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.approvalsService.approve(id, user);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectApprovalDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.approvalsService.reject(id, dto.note, user);
  }
}
