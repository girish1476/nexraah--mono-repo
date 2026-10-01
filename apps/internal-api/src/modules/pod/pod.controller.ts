import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { PodService } from './pod.service';
import { AddDocketDto } from './dto/add-docket.dto';
import { ReceivePodDto } from './dto/receive-pod.dto';
import { UploadEpodDto } from './dto/upload-epod.dto';
import { HardCopyDto } from './dto/hard-copy.dto';
import { VerifyPodDto } from './dto/verify-pod.dto';
import { RejectPodDto } from './dto/reject-pod.dto';
import { WaivePenaltyDto } from './dto/waive-pod.dto';

@Controller('pod')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class PodController {
  constructor(private readonly podService: PodService) {}

  @Get('receiving')
  receiving(@Query('branch') branchId?: string) {
    return this.podService.receiving(branchId);
  }

  @Post(':tripId/docket')
  @RequirePermission('pod.receive')
  addDocket(@Param('tripId') tripId: string, @Body() dto: AddDocketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.addDocket(tripId, dto, user);
  }

  @Post(':tripId/receive')
  @RequirePermission('pod.receive')
  receive(@Param('tripId') tripId: string, @Body() dto: ReceivePodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.receive(tripId, dto, user);
  }

  /** E-POD — the proof as an uploaded photo or scan, instead of waiting for the hard copy. */
  @Post(':tripId/epod')
  @RequirePermission('pod.receive')
  uploadEpod(@Param('tripId') tripId: string, @Body() dto: UploadEpodDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.uploadEpod(tripId, dto, user);
  }

  /** The hard copy followed up after an E-POD: courier docket, slip photo, and when it reached head office. */
  @Post(':tripId/hard-copy')
  @RequirePermission('pod.receive')
  logHardCopy(@Param('tripId') tripId: string, @Body() dto: HardCopyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.logHardCopy(tripId, dto, user);
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
  waive(@Param('tripId') tripId: string, @Body() dto: WaivePenaltyDto, @CurrentUser() user: AuthenticatedUser) {
    return this.podService.waive(tripId, dto, user);
  }
}
