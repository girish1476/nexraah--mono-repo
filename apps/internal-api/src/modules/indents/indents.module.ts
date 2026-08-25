import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { VendorsModule } from '../vendors/vendors.module';
import { IndentsController } from './indents.controller';
import { IndentsService } from './indents.service';
import { IndentsRepository } from './indents.repository';

@Module({
  imports: [VendorsModule, OrdersModule],
  controllers: [IndentsController],
  providers: [IndentsService, IndentsRepository],
  exports: [IndentsRepository],
})
export class IndentsModule {}
