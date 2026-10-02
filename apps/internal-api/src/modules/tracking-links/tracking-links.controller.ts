import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TrackingLinksService } from './tracking-links.service';
import { RoutePointsService, SaveRoutePointsDto } from './route-points.service';

/** The desk's side: see, create and switch off a trip's shareable tracking link. */
@Controller('trips')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class TrackingLinksController {
  constructor(
    private readonly service: TrackingLinksService,
    private readonly routePointsService: RoutePointsService,
  ) {}

  /** Anyone who can see the trip can see whether it is being shared. */
  @Get(':id/tracking/share')
  state(@Param('id') id: string) {
    return this.service.state(id);
  }

  @Post(':id/tracking/share')
  @RequirePermission('indent.manage')
  create(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.create(id, user);
  }

  @Delete(':id/tracking/share')
  @RequirePermission('indent.manage')
  stop(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.stop(id, user);
  }

  /** The exact loading and unloading points of this trip's route — kept per client and route. */
  @Get(':id/route-points')
  routePoints(@Param('id') id: string) {
    return this.routePointsService.get(id);
  }

  @Put(':id/route-points')
  @RequirePermission('indent.manage')
  saveRoutePoints(@Param('id') id: string, @Body() dto: SaveRoutePointsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.routePointsService.save(id, dto, user);
  }
}

/**
 * The recipient's side. **No guards on purpose** — a client or a truck owner
 * has no login; the unguessable token in the URL is what lets them in. The
 * app-wide throttler still applies, and the service returns only what is safe
 * for either side to see.
 */
@Controller('public/tracking')
export class PublicTrackingController {
  constructor(private readonly service: TrackingLinksService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.service.publicView(token);
  }
}
