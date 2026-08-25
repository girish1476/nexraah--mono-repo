import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { ClientsRepository } from './clients.repository';
import { ClientOnboardingController } from './client-onboarding.controller';
import { ClientOnboardingService } from './client-onboarding.service';

@Module({
  /*
   * `ClientOnboardingController` is listed FIRST on purpose. Nest matches
   * routes in registration order, and `ClientsController` has a `@Get(':id')`
   * that would happily swallow `GET /clients/onboarding` and look up a client
   * whose id is the literal string "onboarding".
   */
  controllers: [ClientOnboardingController, ClientsController],
  providers: [ClientsService, ClientsRepository, ClientOnboardingService],
  exports: [ClientsRepository, ClientOnboardingService],
})
export class ClientsModule {}
