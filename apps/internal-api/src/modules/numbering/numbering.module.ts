import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';

/** Global: every wave that mints a business code (VND-, …; the indent and trip series carry no prefix) needs this. */
@Global()
@Module({
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
