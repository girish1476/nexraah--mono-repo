import { Module } from '@nestjs/common';
import { ComplianceController } from './compliance.controller';
import { ComplianceService } from './compliance.service';
import { ComplianceRepository } from './compliance.repository';

@Module({
  controllers: [ComplianceController],
  providers: [ComplianceService, ComplianceRepository],
})
export class ComplianceModule {}
