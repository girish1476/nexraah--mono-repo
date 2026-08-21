import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { TelematicsService } from './telematics.service';

/**
 * `GET /telematics` — the live fleet board (docs/api/10-telematics-import.md).
 * Any authenticated internal principal, same as `GET /config` — no module-
 * level permission gate exists on the backend yet (module visibility is
 * presentation-only in `internal-portal/src/lib/permissions.ts` today).
 */
@Controller()
@UseGuards(SupabaseJwtGuard)
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
}
