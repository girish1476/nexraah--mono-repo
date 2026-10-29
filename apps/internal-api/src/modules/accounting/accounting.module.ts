import { Module } from '@nestjs/common';
import { AccountingController } from './accounting.controller';
import { AccountingRepository } from './accounting.repository';

@Module({
  controllers: [AccountingController],
  providers: [AccountingRepository],
})
export class AccountingModule {}
