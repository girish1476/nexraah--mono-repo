import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { ConfigRepository } from './config.repository';

@Module({
  controllers: [ConfigController],
  providers: [ConfigService, ConfigRepository],
  // TripsModule reads `advance_document_set` to compute `gatesAdvance`
  // live (docs/api/04-trips-lr.md — "must be computed... not hard-coded").
  exports: [ConfigRepository],
})
export class ConfigModule {}
