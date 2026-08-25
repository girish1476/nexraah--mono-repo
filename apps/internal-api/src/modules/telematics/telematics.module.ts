import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { TelematicsController } from './telematics.controller';
import { TelematicsPingController } from './telematics-ping.controller';
import { TelematicsService } from './telematics.service';
import { TelematicsRepository } from './telematics.repository';

@Module({
  imports: [ControlPanelModule],
  controllers: [TelematicsController, TelematicsPingController],
  providers: [TelematicsService, TelematicsRepository],
  exports: [TelematicsService],
})
export class TelematicsModule {}
