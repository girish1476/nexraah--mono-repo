import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditReadService } from './audit-read.service';
import { AuditRepository } from './audit.repository';
import { AuditController } from './audit.controller';

/**
 * Global: every mutating module in every later wave needs `AuditService`
 * (NFR-03).
 *
 * The read side is deliberately NOT exported. `AuditService` writes and is
 * injected almost everywhere; `AuditReadService` queries and is used by one
 * controller. Keeping the query out of the global surface means nothing that
 * writes the trail also carries the ability to read it around.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditReadService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}
