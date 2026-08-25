import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { PortalLoadsService } from './portal-loads.service';
import { SubmitQuoteDto } from './portal-write.dto';
import type { PortalVendor } from './portal.types';

/**
 * `11-portal.md` §5.2. Three decorators, all three load-bearing:
 *
 * - `@PortalRoute()` marks this as the transporter surface, which is what
 *   `PortalAudienceGuard` reads to decide the request is allowed to carry a
 *   service key at all.
 * - `PortalServiceGuard` answers *did this arrive through the vendor edge*,
 *   `PortalVendorGuard` answers *who is this* (`ADR-02` §4).
 * - `PortalExceptionFilter` maps every escaping code into the transporter's
 *   vocabulary. A controller-scoped filter REPLACES the global one, so leaving
 *   it off would let `AllExceptionsFilter` name an internal code.
 */
@PortalRoute()
@Controller('portal')
@UseGuards(PortalServiceGuard, PortalVendorGuard, PortalWriteGuard)
@UseFilters(PortalExceptionFilter)
@UseInterceptors(PortalWriteInterceptor)
export class PortalLoadsController {
  constructor(private readonly loadsService: PortalLoadsService) {}

  @Get('loads')
  listLoads(
    @CurrentVendor() vendor: PortalVendor,
    @Query('truckType') truckType?: string,
    @Query('branch') branch?: string,
  ) {
    return this.loadsService.listLoads(vendor, { truckType, branch });
  }

  /** `code` is the `IND-` series, never `LD-` (`11-portal.md` §5.2). */
  @Get('loads/:code')
  getLoad(@CurrentVendor() vendor: PortalVendor, @Param('code') code: string) {
    return this.loadsService.getLoad(vendor, code);
  }

  @Get('quotes')
  listQuotes(@CurrentVendor() vendor: PortalVendor, @Query('status') status?: string) {
    return this.loadsService.listQuotes(vendor, status);
  }

  /**
   * `201` with the created quote; `200` with the original on a replay of the
   * same `Idempotency-Key` (`11-portal.md` §3). The key is asserted before the
   * body is looked at, so a retry that lost its header fails the same way
   * whatever else is wrong with it.
   */
  @Post('loads/:code/quote')
  submitQuote(
    @CurrentVendor() vendor: PortalVendor,
    @Param('code') code: string,
    @Body() dto: SubmitQuoteDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentRequestId() requestId: string | undefined,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.loadsService.submitQuote(vendor, code, dto, idempotencyKey, requestId);
  }

  /**
   * `204` on success, no body. A replay is `200` with the already-withdrawn
   * quote — `PortalWriteInterceptor` sets that status, because a `204` may not
   * carry the body a replay has to return.
   *
   * `ParseUUIDPipe` rejects a malformed id as `400` before the service runs; a
   * well-formed id belonging to someone else is `404` inside it, never `403`.
   */
  @Delete('quotes/:id')
  @HttpCode(204)
  withdrawQuote(
    @CurrentVendor() vendor: PortalVendor,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentRequestId() requestId: string | undefined,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.loadsService.withdrawQuote(vendor, id, idempotencyKey, requestId);
  }
}
