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
import { DeliverTripDto } from './dto/deliver-trip.dto';

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

  @Get(':id/documents')
  listDocuments(@Param('id') id: string) {
    return this.tripsService.listDocuments(id);
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

  // Override and charge capture are each open to more than one desk — an
  // "any of" the single-code decorator can't say — so the service asserts
  // the permission set itself (`assertAnyPermission`), the way `PnlService`
  // does for view_all | view_own.
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

  // The consignment note is the document the driver carries and the client is
  // billed against. Both writes take `indent.manage`, the same permission as
  // depart/deliver below — the class guard authenticates but does not authorise,
  // so without this any signed-in role could rewrite a consignee or issue an LR.
  @Patch(':id/lr')
  @RequirePermission('indent.manage')
  patchLr(@Param('id') id: string, @Body() dto: PatchLrDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.patchLr(id, dto, user);
  }

  @Post(':id/lr/generate')
  @RequirePermission('indent.manage')
  generateLr(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.generateLr(id, user);
  }

  // Sharing is a write on the LR record (`sharedAt`), so it takes the same
  // permission as the other LR writes above.
  @Post(':id/lr/share')
  @RequirePermission('indent.manage')
  shareLr(@Param('id') id: string) {
    return this.tripsService.shareLr(id);
  }

  @Post(':id/depart')
  @RequirePermission('indent.manage')
  depart(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.depart(id, user);
  }

  @Post(':id/deliver')
  @RequirePermission('indent.manage')
  deliver(@Param('id') id: string, @Body() dto: DeliverTripDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tripsService.deliver(id, dto, user);
  }
}
