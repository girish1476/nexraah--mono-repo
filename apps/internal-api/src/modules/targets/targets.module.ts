import { Module } from '@nestjs/common';
import { TargetsController } from './targets.controller';
import { TargetsService } from './targets.service';
import { TargetsRepository } from './targets.repository';

@Module({
  controllers: [TargetsController],
  providers: [TargetsService, TargetsRepository],
})
export class TargetsModule {}
