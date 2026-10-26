import { Module } from '@nestjs/common';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ClientsModule } from '../clients/clients.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { IndentsModule } from '../indents/indents.module';
import { InvoicingModule } from '../invoicing/invoicing.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { PnlModule } from '../pnl/pnl.module';
import { PodModule } from '../pod/pod.module';
import { ReportsModule } from '../reports/reports.module';
import { RfqModule } from '../rfq/rfq.module';
import { SdrModule } from '../sdr/sdr.module';
import { TargetsModule } from '../targets/targets.module';
import { TelematicsModule } from '../telematics/telematics.module';
import { TicketsModule } from '../tickets/tickets.module';
import { TripsModule } from '../trips/trips.module';
import { VendorsModule } from '../vendors/vendors.module';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { AssistantTools } from './assistant.tools';

/**
 * Reads from every part of the console and writes to none of it: each module
 * here is imported for the one service its own screens read through.
 */
@Module({
  imports: [
    ApprovalsModule,
    ClientsModule,
    ComplianceModule,
    IndentsModule,
    InvoicingModule,
    OrdersModule,
    PaymentsModule,
    PnlModule,
    PodModule,
    ReportsModule,
    RfqModule,
    SdrModule,
    TargetsModule,
    TelematicsModule,
    TicketsModule,
    TripsModule,
    VendorsModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantService, AssistantTools],
})
export class AssistantModule {}
