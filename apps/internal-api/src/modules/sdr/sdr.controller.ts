import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { SdrService } from './sdr.service';
import { RaiseSdrDto, ResolveSdrDto } from './dto/sdr.dto';
import { WaiveSdrDto } from './dto/waive-sdr.dto';

@Controller()
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class SdrController {
  constructor(private readonly sdrService: SdrService) {}

  @Get('sdr')
  list(@Query('status') status?: string, @Query('vendor') vendorId?: string, @Query('trip') tripId?: string) {
    return this.sdrService.list({ status, vendorId, tripId });
  }

  @Get('sdr/summary')
  summary() {
    return this.sdrService.summary();
  }

  @Get('sdr/:id')
  get(@Param('id') id: string) {
    return this.sdrService.get(id);
  }

  // Recording is done by whoever is checking the proof of delivery.
  @Post('trips/:id/sdr')
  @RequirePermission('pod.verify')
  raise(@Param('id') tripId: string, @Body() dto: RaiseSdrDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sdrService.raise(tripId, dto, user);
  }

  // A transporter's unrecovered balance is only ever written off by Compliance,
  // on Leadership's mail, which is recorded with the waiver.
  @Post('sdr/:id/waive')
  @RequirePermission('pod.waive')
  waive(@Param('id') id: string, @Body() dto: WaiveSdrDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sdrService.waive(id, dto, user);
  }

  // Fixing the amount taken from a transporter is the approver's call, the
  // same desk that approves a proof of delivery.
  @Post('sdr/:id/resolve')
  @RequirePermission('pod.approve')
  resolve(@Param('id') id: string, @Body() dto: ResolveSdrDto, @CurrentUser() user: AuthenticatedUser) {
    return this.sdrService.resolve(id, dto, user);
  }
}
