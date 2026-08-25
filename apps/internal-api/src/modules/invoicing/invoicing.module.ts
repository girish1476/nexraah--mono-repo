import { Module } from '@nestjs/common';
import { ConfigModule as ControlPanelModule } from '../config/config.module';
import { InvoicesController } from './invoices.controller';
import { ReceiptsController } from './receipts.controller';
import { ReceivablesController } from './receivables.controller';
import { InvoicingService } from './invoicing.service';
import { InvoicingRepository } from './invoicing.repository';

@Module({
  imports: [ControlPanelModule],
  controllers: [InvoicesController, ReceiptsController, ReceivablesController],
  providers: [InvoicingService, InvoicingRepository],
  exports: [InvoicingService],
})
export class InvoicingModule {}
