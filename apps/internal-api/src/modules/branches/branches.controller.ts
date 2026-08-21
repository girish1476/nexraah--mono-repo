import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BranchesService } from './branches.service';

@Controller('branches')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  // No @RequirePermission: any internal role (docs/api/01-foundation.md).
  @Get()
  list() {
    return this.branchesService.list();
  }
}
