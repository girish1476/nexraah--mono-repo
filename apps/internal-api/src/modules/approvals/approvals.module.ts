import { Global, Module } from '@nestjs/common';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';
import { ApprovalsRepository } from './approvals.repository';
import { ApprovalsRegistry } from './approvals.registry';

/**
 * Global so a later wave's module (indents, payments, POD, …) can inject
 * `ApprovalsService` to call `raise()` and `ApprovalsRegistry` to
 * `register()` its replay handler, without importing this module explicitly.
 */
@Global()
@Module({
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalsRepository, ApprovalsRegistry],
  exports: [ApprovalsService, ApprovalsRegistry],
})
export class ApprovalsModule {}
