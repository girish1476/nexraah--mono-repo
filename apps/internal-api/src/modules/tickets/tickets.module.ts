import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketsRepository } from './tickets.repository';

/**
 * `NumberingModule` and `AuditModule` are both `@Global()`, so neither is
 * imported here — the TKT- series and the audit row both come through them.
 */
@Module({
  controllers: [TicketsController],
  providers: [TicketsService, TicketsRepository],
})
export class TicketsModule {}
