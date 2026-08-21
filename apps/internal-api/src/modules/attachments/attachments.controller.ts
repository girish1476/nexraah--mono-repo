import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DomainException } from '../../common/domain-exception';
import { AttachmentsService } from './attachments.service';

interface UploadMetadataBody {
  kind?: string;
  entityType?: string;
  entityId?: string;
}

@Controller('attachments')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  // No @RequirePermission: any internal role can attach a document — part 01 §7.
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: UploadMetadataBody,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'multipart field "file" is required.');
    }
    return this.attachmentsService.upload(
      { buffer: file.buffer, mime: file.mimetype, kind: body.kind, entityType: body.entityType, entityId: body.entityId },
      user,
    );
  }

  @Get(':id/url')
  getUrl(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attachmentsService.getSignedUrl(id, user);
  }
}
