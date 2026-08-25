import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { OrdersModule } from '../orders/orders.module';
import { PodController } from './pod.controller';
import { PodService } from './pod.service';
import { PodRepository } from './pod.repository';

@Module({
  imports: [ControlPanelModule, OrdersModule],
  controllers: [PodController],
  providers: [PodService, PodRepository],
  exports: [PodRepository],
})
export class PodModule {}
