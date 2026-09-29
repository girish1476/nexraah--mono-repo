import { Module } from '@nestjs/common';
import { SdrController } from './sdr.controller';
import { SdrService } from './sdr.service';
import { SdrRepository } from './sdr.repository';

@Module({
  controllers: [SdrController],
  providers: [SdrService, SdrRepository],
  exports: [SdrRepository],
})
export class SdrModule {}
