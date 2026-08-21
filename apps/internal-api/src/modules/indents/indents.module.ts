import { Module } from '@nestjs/common';
import { VendorsModule } from '../vendors/vendors.module';
import { IndentsController } from './indents.controller';
import { IndentsService } from './indents.service';
import { IndentsRepository } from './indents.repository';

@Module({
  imports: [VendorsModule],
  controllers: [IndentsController],
  providers: [IndentsService, IndentsRepository],
  exports: [IndentsRepository],
})
export class IndentsModule {}
