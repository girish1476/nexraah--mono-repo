import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('clients')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Get()
  list(@Query('q') q?: string) {
    return this.clientsService.list(q);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.clientsService.getById(id);
  }

  @Get(':id/rate-card')
  rateCard(@Param('id') id: string) {
    return this.clientsService.rateCard(id);
  }

  @Post()
  @RequirePermission('client.manage')
  create(@Body() dto: CreateClientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.create(dto, user);
  }

  @Patch(':id')
  @RequirePermission('client.manage')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.update(id, dto, user);
  }
}
