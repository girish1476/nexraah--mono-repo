import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';

/** Global: every wave that mints a business code (VND-, IND-, TRP-, …) needs this. */
@Global()
@Module({
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
