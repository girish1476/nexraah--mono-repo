import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { VendorsService } from './vendors.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { SubmitDocumentDto } from './dto/submit-document.dto';
import { VerifyItemDto } from './dto/verify-item.dto';
import { AdvancePolicyDto } from './dto/advance-policy.dto';
import { BackfillKycValueDto } from './dto/backfill-kyc-value.dto';
import { SuspendVendorDto } from './dto/suspend-vendor.dto';

@Controller('vendors')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class VendorsController {
  constructor(private readonly vendorsService: VendorsService) {}

  // No @RequirePermission on GETs: every internal role can see the vendor
  // file (docs/api/02-vendors-compliance.md), the module matrix (BR-29)
  // is what the frontend uses to decide who lands on this screen at all.
  @Get()
  list(@Query('q') q?: string, @Query('status') status?: string, @Query('branch') branchId?: string) {
    return this.vendorsService.list({ q, status, branchId });
  }

  /**
   * The periodic document audit — whose legal papers have lapsed, and whose
   * are about to.
   *
   * Declared BEFORE `@Get(':id')`, which would otherwise match
   * `/vendors/document-expiry` and look up a vendor whose id is the literal
   * string "document-expiry".
   *
   * No new permission: Compliance already holds `vendor.verify`, and this is
   * the queue for the work that permission describes. Inventing a second
   * permission for the list of things you are already allowed to do would put
   * two locks on one door.
   */
  @Get('document-expiry')
  @RequirePermission('vendor.verify')
  documentExpiry() {
    return this.vendorsService.documentExpiryAudit();
  }

  /**
   * Same route-ordering reason as `document-expiry` above: declared before
   * `@Get(':id')` so it isn't matched as a vendor id lookup.
   */
  @Get('kyc-backfill-queue')
  @RequirePermission('vendor.verify')
  kycBackfillQueue() {
    return this.vendorsService.kycBackfillQueue();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.vendorsService.getById(id);
  }

  @Post()
  @RequirePermission('vendor.edit')
  create(@Body() dto: CreateVendorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorsService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission('vendor.edit')
  update(@Param('id') id: string, @Body() dto: UpdateVendorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorsService.update(id, dto, user);
  }

  @Post(':id/kyc/:kind')
  @RequirePermission('vendor.edit')
  submitKyc(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: SubmitKycDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.submitKyc(id, kind, dto, user);
  }

  @Post(':id/kyc/:kind/verify')
  @RequirePermission('vendor.verify')
  verifyKyc(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: VerifyItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.verifyKyc(id, kind, dto.approve ?? true, dto.reason, user);
  }

  @Patch(':id/kyc/:kind/value')
  @RequirePermission('vendor.verify')
  backfillKycValue(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: BackfillKycValueDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.backfillKycValue(id, kind, dto, user);
  }

  @Post(':id/documents/:kind')
  @RequirePermission('vendor.edit')
  submitDocument(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: SubmitDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.submitDocument(id, kind, dto, user);
  }

  @Post(':id/documents/:kind/verify')
  @RequirePermission('vendor.verify')
  verifyDocument(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: VerifyItemDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.verifyDocument(id, kind, dto.approve ?? true, dto.reason, user);
  }

  @Post(':id/submit')
  @RequirePermission('vendor.edit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorsService.submit(id, user);
  }

  @Post(':id/activate')
  @RequirePermission('vendor.activate')
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorsService.activate(id, user);
  }

  /**
   * Putting a transporter on hold and taking them off it are the same
   * decision as clearing them in the first place — Compliance's — so both
   * sit behind `vendor.activate` rather than a new permission
   * (no new roles or permission codes; the existing desk absorbs the duty).
   * `SUSPENDED` has been in the schema's CHECK constraint and the portal
   * guard since day one; nothing wrote it until now.
   */
  @Post(':id/suspend')
  @RequirePermission('vendor.activate')
  suspend(@Param('id') id: string, @Body() dto: SuspendVendorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorsService.suspend(id, dto.reason, user);
  }

  @Post(':id/reinstate')
  @RequirePermission('vendor.activate')
  reinstate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.vendorsService.reinstate(id, user);
  }

  @Patch(':id/advance-policy')
  @RequirePermission('vendor.advance_policy')
  patchAdvancePolicy(
    @Param('id') id: string,
    @Body() dto: AdvancePolicyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.vendorsService.patchAdvancePolicy(id, dto, user);
  }
}
