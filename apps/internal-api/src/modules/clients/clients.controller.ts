import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

// No named permission gates create/edit here: part 01 §2.4's seed grants name
// no `client.*` code, and FINANCE — the module's only EDIT role (BR-29) —
// holds none that obviously fits (`invoice.create`/`receipt.record` are
// billing actions, not client-master ones). Left open to any authenticated
// internal principal until a real code is added to the roles matrix; flagging
// this rather than reusing an unrelated permission's name.
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
  create(@Body() dto: CreateClientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.create(dto, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateClientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.clientsService.update(id, dto, user);
  }
}
