import { Module } from '@nestjs/common';
import { AttachmentsModule } from '../attachments/attachments.module';
import { OcrController } from './ocr.controller';
import { OcrService } from './ocr.service';

@Module({
  imports: [AttachmentsModule],
  controllers: [OcrController],
  providers: [OcrService],
})
export class OcrModule {}
