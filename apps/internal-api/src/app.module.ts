import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { validateEnv } from './config/env';
import { InternalDbModule } from './db/internal-db.module';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { AuditModule } from './modules/audit/audit.module';
import { NumberingModule } from './modules/numbering/numbering.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuthModule } from './modules/auth/auth.module';
import { BranchesModule } from './modules/branches/branches.module';
import { ConfigModule as ControlPanelModule } from './modules/config/config.module';
import { RolesModule } from './modules/roles/roles.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ComplianceModule } from './modules/compliance/compliance.module';
import { ClientsModule } from './modules/clients/clients.module';
import { IndentsModule } from './modules/indents/indents.module';
import { OrdersModule } from './modules/orders/orders.module';
import { TripsModule } from './modules/trips/trips.module';
import { PodModule } from './modules/pod/pod.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { TelematicsModule } from './modules/telematics/telematics.module';
import { PnlModule } from './modules/pnl/pnl.module';
import { InvoicingModule } from './modules/invoicing/invoicing.module';
import { RfqModule } from './modules/rfq/rfq.module';
import { PortalModule } from './modules/portal/portal.module';
import { JobsModule } from './modules/jobs/jobs.module';

@Module({
  imports: [
    NestConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    InternalDbModule,
    AuditModule,
    NumberingModule,
    ApprovalsModule,
    AuthModule,
    BranchesModule,
    ControlPanelModule,
    RolesModule,
    AttachmentsModule,
    VendorsModule,
    ComplianceModule,
    ClientsModule,
    IndentsModule,
    OrdersModule,
    TripsModule,
    PodModule,
    PaymentsModule,
    ReportsModule,
    TelematicsModule,
    PnlModule,
    InvoicingModule,
    RfqModule,
    PortalModule,
    JobsModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
