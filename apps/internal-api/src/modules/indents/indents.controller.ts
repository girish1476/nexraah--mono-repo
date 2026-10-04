import { Body, Controller, Get, Param, Post, Patch, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { IndentsService } from './indents.service';
import { CreateIndentDto } from './dto/create-indent.dto';
import { AwardIndentDto } from './dto/award-indent.dto';
import { PlacementDto } from './dto/placement.dto';
import { CorrectVehicleDto } from './dto/correct-vehicle.dto';
import { AdvancePctDto } from './dto/advance-pct.dto';
import { RecordQuoteDto } from './dto/record-quote.dto';
import { CancelIndentDto } from './dto/cancel-indent.dto';

@Controller('indents')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class IndentsController {
  constructor(private readonly indentsService: IndentsService) {}

  @Get()
  @RequirePermission('indent.view')
  list(@Query('stage') stage?: string, @Query('branch') branchId?: string, @Query('client') clientId?: string) {
    return this.indentsService.list({ stage, branchId, clientId });
  }

  // Declared before `:id`, or "stale" would be read as an indent id.
  @Get('stale')
  @RequirePermission('indent.view')
  stale(@Query('branch') branchId?: string) {
    return this.indentsService.stale(branchId);
  }

  @Get(':id')
  @RequirePermission('indent.view')
  getById(@Param('id') id: string) {
    return this.indentsService.getById(id);
  }

  @Post()
  @RequirePermission('indent.create')
  create(@Body() dto: CreateIndentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.create(dto, user);
  }

  @Post(':id/quotes')
  @RequirePermission('indent.manage')
  recordQuote(@Param('id') id: string, @Body() dto: RecordQuoteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.recordQuote(id, dto, user);
  }

  @Post(':id/cancel')
  @RequirePermission('indent.manage')
  cancel(@Param('id') id: string, @Body() dto: CancelIndentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.cancel(id, dto, user);
  }

  @Post(':id/keep')
  @RequirePermission('indent.manage')
  keep(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.keep(id, user);
  }

  // Taking a load off its transporter is Leadership's call.
  @Post(':id/reassign-transporter')
  @RequirePermission('indent.reassign')
  reassignTransporter(@Param('id') id: string, @Body() dto: CancelIndentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.reassignTransporter(id, dto, user);
  }

  @Post(':id/award')
  @RequirePermission('indent.manage')
  award(@Param('id') id: string, @Body() dto: AwardIndentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.award(id, dto.quoteId, dto.reason, user);
  }

  @Post(':id/placement')
  @RequirePermission('indent.manage')
  placement(@Param('id') id: string, @Body() dto: PlacementDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.placement(id, dto, user);
  }

  // A mistyped truck number put right — the same truck, not a different one.
  @Post(':id/vehicle-correction')
  @RequirePermission('indent.manage')
  correctVehicle(@Param('id') id: string, @Body() dto: CorrectVehicleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.correctVehicle(id, dto, user);
  }

  @Post(':id/trip')
  @RequirePermission('indent.manage')
  createTrip(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.createTrip(id, user);
  }

  @Patch(':id/advance-pct')
  @RequirePermission('indent.manage')
  patchAdvancePct(@Param('id') id: string, @Body() dto: AdvancePctDto, @CurrentUser() user: AuthenticatedUser) {
    return this.indentsService.patchAdvancePct(id, dto.advancePct, dto.reason, user);
  }
}
