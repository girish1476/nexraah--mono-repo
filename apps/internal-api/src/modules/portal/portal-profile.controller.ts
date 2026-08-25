import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PortalRoute } from '../../common/decorators/portal-route.decorator';
import { PortalServiceGuard } from '../../common/guards/portal-service.guard';
import { PortalVendorGuard } from './portal-vendor.guard';
import { PortalWriteGuard } from './portal-write.guard';
import { PortalExceptionFilter } from './portal-exception.filter';
import { PortalWriteInterceptor } from './portal-write.interceptor';
import { CurrentRequestId, CurrentVendor } from './portal.decorators';
import { assertIdempotencyKey } from './portal-idempotency.repository';
import { MAX_UPLOAD_BYTES } from './portal.constants';
import { PortalProfileService } from './portal-profile.service';
import type { UploadDocumentDto } from './portal-write.dto';
import type { PortalUploadFile } from './portal-storage.service';
import type { PortalVendor } from './portal.types';

/** `11-portal.md` §5.6 — see `portal-loads.controller.ts` on the decorators. */
@PortalRoute()
@Controller('portal')
@UseGuards(PortalServiceGuard, PortalVendorGuard, PortalWriteGuard)
@UseFilters(PortalExceptionFilter)
@UseInterceptors(PortalWriteInterceptor)
export class PortalProfileController {
  constructor(private readonly profileService: PortalProfileService) {}

  /** Masked, and built here rather than dropped from `GET /vendors/:id` (`08-P7` §1). */
  @Get('profile')
  getProfile(@CurrentVendor() vendor: PortalVendor) {
    return this.profileService.getProfile(vendor);
  }

  /**
   * `POST /portal/profile/documents/:kind` — `BR-23`.
   *
   * `multipart/form-data`, one file. Resets the document to `PENDING`; a
   * suspended vendor is refused by `PortalWriteGuard` before this runs.
   */
  @Post('profile/documents/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  uploadDocument(
    @CurrentVendor() vendor: PortalVendor,
    @Param('kind') kind: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: PortalUploadFile | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentRequestId() requestId: string | undefined,
  ) {
    assertIdempotencyKey(idempotencyKey);
    return this.profileService.uploadDocument(
      vendor,
      kind,
      dto,
      file,
      idempotencyKey,
      requestId,
    );
  }
}
