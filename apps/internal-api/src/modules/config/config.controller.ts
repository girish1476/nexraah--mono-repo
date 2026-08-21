import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ConfigService } from './config.service';
import { PatchConfigDto } from './dto/patch-config.dto';
import { PatchNumberSeriesDto } from './dto/patch-number-series.dto';

const CONFIG_MANAGE = 'config.manage'; // fixed to ADMIN — permission_fixed_owners

@Controller()
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  // GET: any internal role. PATCH: config.manage (docs/api/01-foundation.md).
  @Get('config')
  getConfig() {
    return this.configService.getConfig();
  }

  @Patch('config')
  @RequirePermission(CONFIG_MANAGE)
  patchConfig(@Body() dto: PatchConfigDto, @CurrentUser() user: AuthenticatedUser) {
    return this.configService.patchConfig(dto, user);
  }

  @Get('config/number-series')
  listNumberSeries() {
    return this.configService.listNumberSeries();
  }

  @Patch('config/number-series/:key')
  @RequirePermission(CONFIG_MANAGE)
  patchNumberSeries(
    @Param('key') key: string,
    @Body() dto: PatchNumberSeriesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.configService.patchNumberSeries(key, dto, user);
  }
}
