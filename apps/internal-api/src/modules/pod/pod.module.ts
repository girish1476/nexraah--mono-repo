import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { PodController } from './pod.controller';
import { PodService } from './pod.service';
import { PodRepository } from './pod.repository';

@Module({
  imports: [ControlPanelModule],
  controllers: [PodController],
  providers: [PodService, PodRepository],
})
export class PodModule {}
