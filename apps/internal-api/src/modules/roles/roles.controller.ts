import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RolesService } from './roles.service';
import { UpdateRolePermissionDto } from './dto/update-role-permission.dto';

@Controller('admin/roles')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  // GET: any internal role. PATCH: config.manage (docs/api/01-foundation.md).
  @Get()
  getMatrix() {
    return this.rolesService.getMatrix();
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
