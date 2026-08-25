import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TelematicsService } from './telematics.service';
import { ManualUpdateDto } from './dto/manual-update.dto';

/**
 * `GET /telematics` — the live fleet board (docs/api/10-telematics-import.md).
 * Any authenticated internal principal, same as `GET /config` — no module-
 * level permission gate exists on the backend yet (module visibility is
 * presentation-only in `internal-portal/src/lib/permissions.ts` today).
 */
@Controller()
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class TelematicsController {
  constructor(private readonly telematicsService: TelematicsService) {}

  @Get('telematics')
  board() {
    return this.telematicsService.board();
  }

  // Registered before nothing else under /telematics/* takes a second path
  // segment, so there's no risk of the vendors.module.ts-style route-order
  // collision — but named `vehicles/:vehicleNo`, not a bare `:vehicleNo`,
  // to keep it that way even if a sibling route is added here later.
  @Get('telematics/vehicles/:vehicleNo')
  vehicle(@Param('vehicleNo') vehicleNo: string) {
    return this.telematicsService.forVehicle(vehicleNo);
  }

  /**
   * The fleet board's "Update" action (`internal-portal/src/app/telematics/
   * apis.ts` has called this since the board shipped — it 404'd until now).
   * Gated on `indent.manage`: no telematics-specific permission is seeded,
   * and this is the same gate the trip page's depart/deliver actions use —
   * held by the roles the portal's module matrix gives EDIT on telematics.
   */
  @Patch('telematics/vehicles/:vehicleNo')
  @RequirePermission('indent.manage')
  update(
    @Param('vehicleNo') vehicleNo: string,
    @Body() dto: ManualUpdateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.telematicsService.manualUpdate(vehicleNo, dto, user);
  }
}
