import { Module } from '@nestjs/common';
import { VendorsController } from './vendors.controller';
import { VendorsService } from './vendors.service';
import { VendorsRepository } from './vendors.repository';
import { VendorPortalAccountService } from './vendor-portal-account.service';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadsRepository } from './leads.repository';
import { MarketGapController } from './market-gap.controller';
import { MarketGapService } from './market-gap.service';
import { MarketGapRepository } from './market-gap.repository';
import { IssuesController } from './issues.controller';
import { IssuesService } from './issues.service';
import { IssuesRepository } from './issues.repository';

@Module({
  // LeadsController/MarketGapController/IssuesController MUST register before
  // VendorsController: Nest/Express matches routes in registration order, and
  // `GET /vendors/:id` would otherwise swallow `GET /vendors/leads` (etc.) as
  // `id = "leads"` — a UUID column comparison that fails at the database
  // rather than 404ing, which is how this was actually caught.
  controllers: [LeadsController, MarketGapController, IssuesController, VendorsController],
  providers: [
    VendorsService,
    VendorsRepository,
    VendorPortalAccountService,
    LeadsService,
    LeadsRepository,
    MarketGapService,
    MarketGapRepository,
    IssuesService,
    IssuesRepository,
  ],
  // IndentsModule reads vendor status/advance_pct at award time (BR-01, BR-30).
  exports: [VendorsRepository, VendorsService],
})
export class VendorsModule {}
