import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global: every mutating module in every later wave needs `AuditService` (NFR-03). */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
