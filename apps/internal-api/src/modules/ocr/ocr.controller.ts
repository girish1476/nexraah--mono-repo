import { Body, Controller, Param, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Express } from 'express';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ReadDocumentDto } from './ocr.dto';
import { OcrService } from './ocr.service';

@Controller('attachments')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class OcrController {
  constructor(private readonly ocrService: OcrService) {}

  // A file being uploaded, read before it is stored — the Fetch button beside a
  // file picker. Multipart: `file`, and `request` holding a ReadDocumentDto as
  // JSON. Open to whoever may upload a document; the service checks which.
  @Post('read')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  readUpload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('request') request: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'multipart field "file" is required.');
    }
    return this.ocrService.readUpload({ buffer: file.buffer, mime: file.mimetype }, parseRequest(request), user);
  }

  // Whoever verifies a document is who reads it. Each read is a paid call to
  // an outside service, so it is held to a few a minute per caller.
  @Post(':id/read')
  @RequirePermission('document.verify')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  read(@Param('id') id: string, @Body() dto: ReadDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.ocrService.readAttachment(id, dto, user);
  }
}

/**
 * A multipart text part is a string, so the global validation pipe never sees
 * the request inside it. It is held to the same rules here.
 */
function parseRequest(raw: string | undefined): ReadDocumentDto {
  let body: unknown;
  try {
    body = JSON.parse(raw ?? '');
  } catch {
    throw new DomainException(400, 'VALIDATION_ERROR', 'multipart field "request" must be JSON.');
  }
  const dto = plainToInstance(ReadDocumentDto, body);
  if (typeof dto !== 'object' || dto === null || Array.isArray(dto)) {
    throw new DomainException(400, 'VALIDATION_ERROR', 'multipart field "request" must be a JSON object.');
  }
  const errors = validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length > 0) {
    throw new DomainException(400, 'VALIDATION_ERROR', 'The details asked for are not in the right form.');
  }
  return dto;
}
