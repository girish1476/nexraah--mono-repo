import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
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

  // The portal only offers the target editor to `vendor.edit` holders
  // (`vendors/market-gap/page.tsx`). The earlier note here said the module
  // matrix gated it instead — but nothing server-side reads the module
  // matrix (`PermissionsGuard` only knows named permissions), so without this
  // any signed-in role could rewrite a branch's supply target directly.
  @Patch(':id')
  @RequirePermission('vendor.edit')
  update(@Param('id') id: string, @Body() dto: UpdateMarketGapDto) {
    return this.marketGapService.updateTarget(id, dto.target);
  }
}
