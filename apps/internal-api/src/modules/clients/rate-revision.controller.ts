import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RateRevisionService } from './rate-revision.service';
import { ProposeRateRevisionDto } from './dto/propose-rate-revision.dto';
import { AddRateLaneDto } from './dto/add-rate-lane.dto';
import { SetLaneBandDto } from './dto/set-lane-band.dto';

/**
 * Client rate revision — Finance's routes.
 *
 * A third controller on `clients` alongside the commercial record
 * (`client.manage`) and onboarding (`client.onboard`), for the same reason
 * there is a second: a different permission with a different owner, and no
 * route where it is ambiguous which one applies.
 *
 * Both routes sit under `/clients/:id/...`, so neither collides with
 * `ClientsController`'s `@Get(':id')` and this controller's position in the
 * module's `controllers` array does not matter — unlike
 * `ClientOnboardingController`, whose `/clients/onboarding` does collide and
 * must stay declared first.
 */
@Controller('clients')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class RateRevisionController {
  constructor(private readonly revisions: RateRevisionService) {}

  /**
   * The history behind a client's rate card: what changed, why, and who signed
   * it. Gated on `rate.revise` rather than left open, because the reason text
   * is commercially sensitive — it names what was conceded and to whom.
   */
  @Get(':id/rate-revisions')
  @RequirePermission('rate.revise')
  list(@Param('id') id: string) {
    return this.revisions.list(id);
  }

  /**
   * Proposes a lane the client's rate card does not have yet. `rate.revise`,
   * the same permission as a revision: it commits us to a price, and Finance
   * proposing while Compliance/Leadership approve keeps the second signature.
   */
  @Post(':id/rate-card')
  @RequirePermission('rate.revise')
  addLane(@Param('id') id: string, @Body() dto: AddRateLaneDto, @CurrentUser() user: AuthenticatedUser) {
    return this.revisions.addLane(id, dto, user);
  }

  /**
   * Proposes, never applies. Returns `202 approvalRequired` — the rate does not
   * move until somebody with `approve.contract` countersigns, and no desk holds
   * both permissions.
   */
  @Post(':id/rate-revisions')
  @RequirePermission('rate.revise')
  propose(
    @Param('id') id: string,
    @Body() dto: ProposeRateRevisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.revisions.propose(id, dto, user);
  }

  /**
   * Sets a lane's bid band — the floor and ceiling a transporter quote is
   * judged against. `client.manage`, the commercial-record permission, not
   * `rate.revise`: it does not move the agreed price. The first band applies
   * at once; changing an existing one returns `202 approvalRequired` and waits
   * for Leadership.
   */
  @Put(':id/rate-card/:laneId/band')
  @RequirePermission('client.manage')
  setBand(
    @Param('id') id: string,
    @Param('laneId') laneId: string,
    @Body() dto: SetLaneBandDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.revisions.setLaneBand(id, laneId, dto, user);
  }
}
