import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { ClientOnboardingService } from './client-onboarding.service';
import { SubmitClientDocumentDto } from './dto/submit-client-document.dto';
import { DecideClientDocumentDto } from './dto/decide-client-document.dto';
import { RejectClientDto } from './dto/reject-client.dto';

/**
 * Client onboarding — Compliance's routes.
 *
 * Separate controller from `ClientsController` on purpose: that one is
 * Finance's commercial record and is gated on `client.manage`, these are the
 * clearance pipeline and are gated on `client.onboard`. Two permissions, two
 * owners, and no route where it is ambiguous which applies.
 *
 * Reading the queue takes `client.onboard` too. It is a work queue, not a
 * report — anyone who can see it can act on it, and there is no case for
 * showing a desk a list of decisions it cannot make.
 */
@Controller('clients')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class ClientOnboardingController {
  constructor(private readonly onboarding: ClientOnboardingService) {}

  /**
   * Declared before `ClientsController`'s `@Get(':id')` would match it —
   * `onboarding` is a literal segment and must not be read as a client id.
   */
  @Get('onboarding')
  @RequirePermission('client.onboard')
  queue() {
    return this.onboarding.queue();
  }

  @Get(':id/onboarding')
  @RequirePermission('client.onboard')
  detail(@Param('id') id: string) {
    return this.onboarding.detail(id);
  }

  @Post(':id/onboarding/documents')
  @RequirePermission('client.onboard')
  submitDocument(
    @Param('id') id: string,
    @Body() dto: SubmitClientDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboarding.submitDocument(id, dto, user);
  }

  @Post(':id/onboarding/documents/:kind/decide')
  @RequirePermission('client.onboard')
  decideDocument(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() dto: DecideClientDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.onboarding.decideDocument(id, kind as never, dto, user);
  }

  @Post(':id/onboarding/activate')
  @RequirePermission('client.onboard')
  activate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.activate(id, user);
  }

  @Post(':id/onboarding/reject')
  @RequirePermission('client.onboard')
  reject(@Param('id') id: string, @Body() dto: RejectClientDto, @CurrentUser() user: AuthenticatedUser) {
    return this.onboarding.reject(id, dto.reason, user);
  }
}
