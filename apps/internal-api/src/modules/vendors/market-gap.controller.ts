import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { MarketGapService } from './market-gap.service';
import { CreateMarketGapDto, UpdateMarketGapDto } from './dto/update-market-gap.dto';

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
    return this.marketGapService.update(id, dto);
  }

  /**
   * Record a lane where the panel is thin. The screen used to have no way to
   * add one — rows only ever came from seed data, so a gap Operations could
   * see on the ground could not be written down.
   */
  @Post()
  @RequirePermission('vendor.edit')
  create(@Body() dto: CreateMarketGapDto, @CurrentUser() user: AuthenticatedUser) {
    return this.marketGapService.create(dto, user);
  }
}
