import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { FilesController } from './files.controller';
import { AttachmentsService } from './attachments.service';
import { AttachmentsRepository } from './attachments.repository';
import { StorageService } from './storage.service';

@Module({
  controllers: [AttachmentsController, FilesController],
  providers: [AttachmentsService, AttachmentsRepository, StorageService],
  exports: [StorageService, AttachmentsRepository],
})
export class AttachmentsModule {}
