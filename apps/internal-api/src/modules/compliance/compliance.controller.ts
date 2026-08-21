import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ComplianceService } from './compliance.service';

@Controller('compliance')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ComplianceController {
  constructor(private readonly complianceService: ComplianceService) {}

  // No @RequirePermission: the `compliance` module matrix entry (BR-29) is
  // COMPLIANCE=EDIT, FINANCE=VIEW, everyone else NONE — enforced by the
  // frontend's navigation and by every downstream verify action's own guard;
  // the queue itself is read-only.
  @Get('queues')
  queues() {
    return this.complianceService.queues();
  }
}
