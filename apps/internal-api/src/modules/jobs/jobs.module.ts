import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { PodModule } from '../pod/pod.module';
import { IndentsModule } from '../indents/indents.module';
import { TelematicsModule } from '../telematics/telematics.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { PnlModule } from '../pnl/pnl.module';
import { AttachmentsModule } from '../attachments/attachments.module';
import { VendorsModule } from '../vendors/vendors.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { JobsRepository } from './jobs.repository';

@Module({
  imports: [ControlPanelModule, PodModule, IndentsModule, TelematicsModule, InvoicingModule, PnlModule, AttachmentsModule, VendorsModule],
  controllers: [JobsController],
  providers: [JobsService, JobsRepository],
})
export class JobsModule {}
