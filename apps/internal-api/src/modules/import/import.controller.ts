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
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { DomainException } from '../../common/domain-exception';
import { ImportService } from './import.service';
import { isImportSet, IMPORT_SETS } from './import.rules';

/** 10 MB, matching `POST /attachments` — a go-live CSV is text and far smaller. */
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

@Controller('admin/import')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  /**
   * Declared before `:set`, because Nest matches in declaration order and
   * `history` would otherwise be read as a set name.
   */
  @Get('history')
  @RequirePermission('config.manage')
  history() {
    return this.importService.history();
  }

  @Post(':set')
  @RequirePermission('config.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  dryRun(
    @Param('set') set: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'multipart field "file" is required.');
    }
    return this.importService.dryRun(this.assertSet(set), file, user);
  }

  @Post(':set/commit')
  @RequirePermission('config.manage')
  commit(
    @Param('set') set: string,
    @Body() body: { batchId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!body?.batchId) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'batchId is required.');
    }
    return this.importService.commit(this.assertSet(set), body.batchId, user);
  }

  private assertSet(set: string) {
    if (!isImportSet(set)) {
      throw new DomainException(
        400,
        'VALIDATION_ERROR',
        `Unknown import set "${set}". Expected one of: ${IMPORT_SETS.join(', ')}.`,
      );
    }
    return set;
  }
}
