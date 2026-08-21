import { Module } from '@nestjs/common';
import { PnlController } from './pnl.controller';
import { PnlService } from './pnl.service';
import { PnlRepository } from './pnl.repository';

@Module({
  controllers: [PnlController],
  providers: [PnlService, PnlRepository],
})
export class PnlModule {}
