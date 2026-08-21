import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';
import { TripsRepository } from './trips.repository';

@Module({
  imports: [ControlPanelModule],
  controllers: [TripsController],
  providers: [TripsService, TripsRepository],
})
export class TripsModule {}
