import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { RfqController } from './rfq.controller';
import { RfqService } from './rfq.service';
import { RfqRepository } from './rfq.repository';

@Module({
  imports: [ControlPanelModule],
  controllers: [RfqController],
  providers: [RfqService, RfqRepository],
})
export class RfqModule {}
