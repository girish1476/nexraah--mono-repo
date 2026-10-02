import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SetTargetsDto } from './targets.dto';
import { TargetsService } from './targets.service';

@Controller('targets')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class TargetsController {
  constructor(private readonly targetsService: TargetsService) {}

  // No @RequirePermission on the two reads — the same footing as
  // `GET /reports/home`: My desk is open to every desk, and what a person sees
  // there is narrowed by their own role and branch, not by a permission.
  @Get('desk')
  desk(@CurrentUser() user: AuthenticatedUser) {
    return this.targetsService.desk(user);
  }

  @Get()
  list(@Query('month') month?: string) {
    return this.targetsService.list(month);
  }

  @Put()
  @RequirePermission('config.manage')
  set(@Body() dto: SetTargetsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.targetsService.set(dto, user);
  }
}
