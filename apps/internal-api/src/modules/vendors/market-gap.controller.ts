import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { MarketGapService } from './market-gap.service';
import { UpdateMarketGapDto } from './dto/update-market-gap.dto';

@Controller('vendors/market-gap')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class MarketGapController {
  constructor(private readonly marketGapService: MarketGapService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.marketGapService.list(user);
  }

  // No @RequirePermission: editable by whoever can see it (rfq.edit-tier
  // roles per MODULE_ACCESS) — the module matrix, not a named permission,
  // gates this screen (BR-29).
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMarketGapDto) {
    return this.marketGapService.updateTarget(id, dto.target);
  }
}
