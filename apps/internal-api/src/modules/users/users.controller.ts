import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { UsersService } from './users.service';
import { AllowEmailDto, UpdateAllowedEmailDto } from './dto/allow-email.dto';

/** Allowed emails — who may sign in, and with which role. All three need `config.manage`. */
@Controller('admin/users')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermission('config.manage')
  list() {
    return this.usersService.list();
  }

  @Post()
  @RequirePermission('config.manage')
  allow(@Body() dto: AllowEmailDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.allow(dto, user);
  }

  @Patch(':id')
  @RequirePermission('config.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAllowedEmailDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, user);
  }
}
