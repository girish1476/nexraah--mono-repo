import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { OrdersModule } from '../orders/orders.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripsRepository } from './trips.repository';

// `OrdersModule` exports `OrdersService` so the transitions here — LR release,
// document submission, departure and delivery — can move the ten-step ladder
// without re-deriving it. See `syncOrder()` in the service.
@Module({
  imports: [ControlPanelModule, OrdersModule],
  controllers: [TripsController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
