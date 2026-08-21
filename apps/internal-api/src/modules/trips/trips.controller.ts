import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TripsService } from './trips.service';
import { SubmitTripDocumentDto } from './dto/submit-document.dto';
import { RejectTripDocumentDto } from './dto/reject-document.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PatchLrDto } from './dto/patch-lr.dto';
import { CrossCheckOverrideDto } from './dto/cross-check-override.dto';

@Controller('trips')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class TripsController {
  constructor(private readonly tripsService: TripsService) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('field') field?: string,
    @Query('stage') stage?: string,
    @Query('branch') branchId?: string,
    @Query('transporter') vendorId?: string,
    @Query('pod_status') podStatus?: string,
  ) {
    return this.tripsService.list({ q, field, stage, branchId, vendorId, podStatus });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.tripsService.getById(id);
  }

  @Post(':id/documents/:kind')
  submitDocument(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: SubmitTripDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tripsService.submitDocument(id, kind, dto, user);
  }

  @Post(':id/documents/:kind/verify')
  @RequirePermission('document.verify')
  verifyDocument(@Param('id') id: string, @Param('kind') kind: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.verifyDocument(id, kind, user);
  }

  @Post(':id/documents/:kind/reject')
  @RequirePermission('document.verify')
  rejectDocument(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: RejectTripDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tripsService.rejectDocument(id, kind, dto.reason, user);
  }

  @Get(':id/cross-check')
  crossCheck(@Param('id') id: string) {
    return this.tripsService.crossCheck(id);
  }

  @Post(':id/cross-check/override')
  overrideCrossCheck(@Param('id') id: string, @Body() dto: CrossCheckOverrideDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.overrideCrossCheck(id, dto.reason, user);
  }

  @Get(':id/charges')
  listCharges(@Param('id') id: string) {
    return this.tripsService.listCharges(id);
  }

  @Post(':id/charges')
  createCharge(@Param('id') id: string, @Body() dto: CreateChargeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.createCharge(id, dto, user);
  }

  @Get(':id/lr')
  getLr(@Param('id') id: string) {
    return this.tripsService.getLr(id);
  }

  @Patch(':id/lr')
  patchLr(@Param('id') id: string, @Body() dto: PatchLrDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.patchLr(id, dto, user);
  }

  @Post(':id/lr/generate')
  generateLr(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.generateLr(id, user);
  }

  @Post(':id/lr/share')
  shareLr(@Param('id') id: string) {
    return this.tripsService.shareLr(id);
  }
}
