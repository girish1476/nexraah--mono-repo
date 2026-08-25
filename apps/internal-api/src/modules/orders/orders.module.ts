import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './orders.repository';

/**
 * `OrdersService` is exported so the modules that actually move an order —
 * indents, trips, pod, payments — can call `recompute()` at their own
 * transition points without importing the repository or, worse, re-deriving
 * the ladder themselves.
 */
// `NumberingModule` is `@Global()`, so it needs no import here. `ConfigModule`
// is not — it exports `ConfigRepository`, which the ladder reads
// `advance_document_set` from rather than keeping its own copy of the list.
@Module({
  imports: [ConfigModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersRepository],
  exports: [OrdersService],
})
export class OrdersModule {}
