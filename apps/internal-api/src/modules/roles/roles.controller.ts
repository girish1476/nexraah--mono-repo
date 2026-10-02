import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RolesService } from './roles.service';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';

@Controller('admin/roles')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // GET: any internal role. Everything else: config.manage (docs/api/01-foundation.md).
  @Get()
  getMatrix() {
    return this.rolesService.getMatrix();
  }

  @Post()
  @RequirePermission('config.manage')
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.createRole(dto, user);
  }

  @Delete(':role')
  @RequirePermission('config.manage')
  deleteRole(@Param('role') role: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.deleteRole(role, user);
  }

  @Patch(':role/permissions')
  @RequirePermission('config.manage')
  updatePermission(
    @Param('role') role: string,
    @Body() dto: UpdateRolePermissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rolesService.updatePermission(role, dto, user);
  }
}
