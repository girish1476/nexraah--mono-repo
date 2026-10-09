import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { OrdersModule } from '../orders/orders.module';
import { SdrModule } from '../sdr/sdr.module';
import { TripsModule } from '../trips/trips.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentsRepository } from './payments.repository';

@Module({
  imports: [ControlPanelModule, OrdersModule, SdrModule, TripsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentsRepository],
  // Read by the console's assistant, which answers from the same queues these screens show.
  exports: [PaymentsService],
})
export class PaymentsModule {}
