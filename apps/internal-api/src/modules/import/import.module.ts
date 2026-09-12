import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { ImportRepository } from './import.repository';

// `AuditService` arrives via the global AuditModule (NFR-03), same as every
// other mutating module — nothing to import here.
@Module({
  controllers: [ImportController],
  providers: [ImportService, ImportRepository],
})
export class ImportModule {}
