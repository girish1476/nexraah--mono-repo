import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { AddLaneDto } from './dto/add-lane.dto';
import { SetSourcingDto } from './dto/set-sourcing.dto';
import { SetBuildupDto } from './dto/set-buildup.dto';
import { AwardRfqDto } from './dto/award-rfq.dto';

@Controller('rfqs')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class RfqController {
  constructor(private readonly rfqService: RfqService) {}

  @Get()
  list(@Query('status') status?: string, @Query('client') client?: string) {
    return this.rfqService.list({ status, clientId: client });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.rfqService.getById(id);
  }

  @Post()
  create(@Body() dto: CreateRfqDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqService.create(dto, user);
  }

  @Post(':id/lanes')
  @RequirePermission('rfq.edit')
  addLane(@Param('id') id: string, @Body() dto: AddLaneDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqService.addLane(id, dto, user);
  }

  @Patch(':id/lanes/:laneId/sourcing')
  @RequirePermission('rfq.edit')
  setSourcing(
    @Param('id') id: string,
    @Param('laneId') laneId: string,
    @Body() dto: SetSourcingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqService.setSourcing(id, laneId, dto, user);
  }

  @Patch(':id/lanes/:laneId/buildup')
  @RequirePermission('rfq.edit')
  setBuildup(
    @Param('id') id: string,
    @Param('laneId') laneId: string,
    @Body() dto: SetBuildupDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rfqService.setBuildup(id, laneId, dto, user);
  }

  @Post(':id/submit')
  @RequirePermission('rfq.submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqService.submit(id, user);
  }

  @Post(':id/award')
  @RequirePermission('rfq.edit')
  award(@Param('id') id: string, @Body() dto: AwardRfqDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rfqService.award(id, dto, user);
  }
}
