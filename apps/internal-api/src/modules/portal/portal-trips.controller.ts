import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UploadedFile,
  UploadedFiles,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { PortalRoute } from '../../common/decorators/portal-route.decorator';
import { PortalServiceGuard } from '../../common/guards/portal-service.guard';
import { PortalVendorGuard } from './portal-vendor.guard';
import { PortalWriteGuard } from './portal-write.guard';
import { PortalExceptionFilter } from './portal-exception.filter';
import { PortalWriteInterceptor } from './portal-write.interceptor';
import { CurrentRequestId, CurrentVendor } from './portal.decorators';
import { assertIdempotencyKey } from './portal-idempotency.repository';
import { MAX_UPLOAD_BYTES, MAX_POD_FILES } from './portal.constants';
import { PortalTripsService } from './portal-trips.service';
import type { AttachPodDto, SubmitBillDto } from './portal-write.dto';
import type { PortalUploadFile } from './portal-storage.service';
import type { PortalVendor } from './portal.types';

/** `11-portal.md` §5.4 — see `portal-loads.controller.ts` on the decorators. */
/**
 * `PortalWriteGuard` refuses every non-GET from a suspended vendor, and
 * `PortalWriteInterceptor` unwraps `PortalWriteResult` so a replay answers 200
 * with the original body instead of 201 with the envelope. Both are class-wide
 * here rather than per-route: a write added later inherits them, where a
 * per-route list is one forgotten decorator away from an unguarded upload.
 */
@PortalRoute()
@Controller('portal')
@UseGuards(PortalServiceGuard, PortalVendorGuard, PortalWriteGuard)
@UseFilters(PortalExceptionFilter)
@UseInterceptors(PortalWriteInterceptor)
export class PortalTripsController {
  constructor(private readonly tripsService: PortalTripsService) {}

  @Get('trips')
  listTrips(@CurrentVendor() vendor: PortalVendor, @Query('status') status?: string) {
    return this.tripsService.listTrips(vendor, status);
  }

  @Get('trips/:id')
  getTrip(@CurrentVendor() vendor: PortalVendor, @Param('id') id: string) {
    return this.tripsService.getTrip(vendor, id);
  }

  /** `BR-54`, `D-36`. Another vendor's trip is a 404 here, never a 403. */
  @Get('trips/:id/lorry-receipt')
  getLorryReceipt(@CurrentVendor() vendor: PortalVendor, @Param('id') id: string) {
    return this.tripsService.getLorryReceipt(vendor, id);
  }

  /**
   * The blocked-state checklist the bill screen renders BEFORE the form —
   * `07-P6` §2. A read, so no idempotency key.
   */
  @Get('trips/:id/bill')
  getBillChecklist(@CurrentVendor() vendor: PortalVendor, @Param('id') id: string) {
    return this.tripsService.getBillChecklist(vendor, id);
  }

  /**
   * `POST /portal/trips/:id/pod` — `BR-51`.
   *
   * `multipart/form-data`. The limit is enforced by `multer` here as well as by
   * the storage service, so a file too large to buffer is refused before it is
   * read rather than after — and `PortalExceptionFilter` maps multer's own
   * rejection onto the same `FILE_TOO_LARGE` the service raises, so the two
   * paths are indistinguishable to the caller.
   */
  @Post('trips/:id/pod')
  @UseInterceptors(
    FilesInterceptor('files', MAX_POD_FILES, { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  attachPod(
    @CurrentVendor() vendor: PortalVendor,
    @Param('id') id: string,
    @Body() dto: AttachPodDto,
    @UploadedFiles() files: PortalUploadFile[],
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentRequestId() requestId: string | undefined,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.tripsService.attachPod(vendor, id, dto, files ?? [], idempotencyKey, requestId);
  }

  /**
   * `POST /portal/trips/:id/bill` — `BR-53`.
   *
   * A bill above the computed balance is accepted and flagged, never rejected.
   */
  @Post('trips/:id/bill')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  submitBill(
    @CurrentVendor() vendor: PortalVendor,
    @Param('id') id: string,
    @Body() dto: SubmitBillDto,
    @UploadedFile() file: PortalUploadFile | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentRequestId() requestId: string | undefined,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.tripsService.submitBill(vendor, id, dto, file, idempotencyKey, requestId);
  }
}
