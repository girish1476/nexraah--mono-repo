import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { PortalRoute } from '../../common/decorators/portal-route.decorator';
import { PortalServiceGuard } from '../../common/guards/portal-service.guard';
import { PortalVendorGuard } from './portal-vendor.guard';
import { PortalWriteGuard } from './portal-write.guard';
import { PortalExceptionFilter } from './portal-exception.filter';
import { PortalWriteInterceptor } from './portal-write.interceptor';
import { CurrentRequestId, CurrentVendor } from './portal.decorators';
import { assertIdempotencyKey } from './portal-idempotency.repository';
import { PortalFleetService } from './portal-fleet.service';
import { AddVehicleDto, UpdateVehicleDto } from './portal-write.dto';
import type { PortalVendor } from './portal.types';

/** `11-portal.md` §5.3 — see `portal-loads.controller.ts` on the decorators. */
@PortalRoute()
@Controller('portal')
@UseGuards(PortalServiceGuard, PortalVendorGuard, PortalWriteGuard)
@UseFilters(PortalExceptionFilter)
@UseInterceptors(PortalWriteInterceptor)
export class PortalFleetController {
  constructor(private readonly fleetService: PortalFleetService) {}

  @Get('fleet')
  listFleet(
    @CurrentVendor() vendor: PortalVendor,
    @Query('availability') availability?: string,
  ) {
    return this.fleetService.listFleet(vendor, availability);
  }

  /** `201` with the new vehicle; `200` with the original on a replay (§3). */
  @Post('fleet')
  addVehicle(
    @CurrentVendor() vendor: PortalVendor,
    @Body() dto: AddVehicleDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentRequestId() requestId: string | undefined,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.fleetService.addVehicle(vendor, dto, idempotencyKey, requestId);
  }

  /** `200` with the updated vehicle; `200` with the current row on a replay. */
  @Patch('fleet/:id')
  updateVehicle(
    @CurrentVendor() vendor: PortalVendor,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVehicleDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentRequestId() requestId: string | undefined,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.fleetService.updateVehicle(vendor, id, dto, idempotencyKey, requestId);
  }
}
