import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PodService } from './pod.service';
import { ReceivePodDto } from './dto/receive-pod.dto';
import { VerifyPodDto } from './dto/verify-pod.dto';
import { RejectPodDto } from './dto/reject-pod.dto';
import { WaivePodDto } from './dto/waive-pod.dto';

@Controller('pod')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class PodController {
  constructor(private readonly podService: PodService) {}

  @Get('receiving')
  receiving(@Query('branch') branchId?: string) {
    return this.podService.receiving(branchId);
  }

  @Post(':tripId/receive')
  @RequirePermission('pod.receive')
  receive(@Param('tripId') tripId: string, @Body() dto: ReceivePodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.receive(tripId, dto, user);
  }

  @Get('pending')
  pending(
    @Query('branch') branchId?: string,
    @Query('transporter') vendorId?: string,
    @Query('ageing') ageing?: string,
  ) {
    return this.podService.pending({ branchId, vendorId, ageing });
  }

  @Get(':tripId')
  getById(@Param('tripId') tripId: string) {
    return this.podService.getById(tripId);
  }

  @Post(':tripId/verify')
  @RequirePermission('pod.verify')
  verify(@Param('tripId') tripId: string, @Body() dto: VerifyPodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.verify(tripId, dto, user);
  }

  @Post(':tripId/reject')
  @RequirePermission('pod.verify')
  reject(@Param('tripId') tripId: string, @Body() dto: RejectPodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.reject(tripId, dto.reason, user);
  }

  @Post(':tripId/approve')
  @RequirePermission('pod.approve')
  approve(@Param('tripId') tripId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.approve(tripId, user);
  }

  @Post(':tripId/waive')
  @RequirePermission('pod.waive')
  waive(@Param('tripId') tripId: string, @Body() dto: WaivePodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.waive(tripId, dto.reason, user);
  }
}
