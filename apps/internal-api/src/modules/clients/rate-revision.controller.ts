import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { assertAnyPermission } from '../../common/guards/assert-any-permission';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { RateRevisionService } from './rate-revision.service';
import { ProposeRateRevisionDto } from './dto/propose-rate-revision.dto';
import { AddRateLaneDto } from './dto/add-rate-lane.dto';
import { SetLaneBandDto } from './dto/set-lane-band.dto';
import { CorrectRateLaneDto, EditPendingRateLaneDto, EditPendingRateRevisionDto } from './dto/correct-rate.dto';

/** Why a duplicate rate is being removed — kept with the deleted row and in the audit trail. */
class DeleteRateDto {
  @IsString() @MinLength(10) reason!: string;
}

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
  list(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    // Also the desks that sign a change off (`approve.contract`) — Leadership
    // and an administrator delete a duplicate from this list, so they must see it.
    assertAnyPermission(user, ['rate.revise', 'approve.contract']);
    return this.revisions.list(id);
  }

  /**
   * Deletes a duplicate lane from the rate card. Leadership or an
   * administrator only — checked in the service by role. The lane is kept and
   * marked deleted; loads already raised on it keep their price.
   */
  @Delete(':id/rate-card/:laneId')
  deleteLane(
    @Param('id') id: string,
    @Param('laneId') laneId: string,
    @Body() dto: DeleteRateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.revisions.deleteLane(id, laneId, dto.reason, user);
  }

  /**
   * Proposed lanes that were turned down, to be corrected and sent again.
   * Declared before `:id/rate-card/pending/:approvalId` and the lane routes so
   * "rejected" is never read as a lane id.
   */
  @Get(':id/rate-card/rejected')
  rejectedLanes(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    assertAnyPermission(user, ['rate.revise', 'approve.contract', 'client.manage']);
    return this.revisions.rejectedLanes(id);
  }

  /** A turned-down proposal put aside, once its corrected one has been sent. */
  @Post(':id/rate-card/rejected/:approvalId/dismiss')
  dismissRejectedLane(@Param('id') id: string, @Param('approvalId') approvalId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.revisions.dismissRejectedLane(id, approvalId, user);
  }

  /** A proposed lane still waiting for sign-off, corrected where it waits. Permission checked in the service. */
  @Patch(':id/rate-card/pending/:approvalId')
  editPendingLane(
    @Param('id') id: string,
    @Param('approvalId') approvalId: string,
    @Body() dto: EditPendingRateLaneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.revisions.editPendingLane(id, approvalId, dto, user);
  }

  /** An agreed rate typed wrongly, put right at once with a reason. Permission checked in the service. */
  @Patch(':id/rate-card/:laneId')
  correctLane(
    @Param('id') id: string,
    @Param('laneId') laneId: string,
    @Body() dto: CorrectRateLaneDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.revisions.correctLane(id, laneId, dto, user);
  }

  /** A rate change still waiting for sign-off, corrected in place. Permission checked in the service. */
  @Patch(':id/rate-revisions/:revisionId')
  editPendingRevision(
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
    @Body() dto: EditPendingRateRevisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.revisions.editPendingRevision(id, revisionId, dto, user);
  }

  /** Deletes a lane still waiting for sign-off. Leadership or an administrator only. */
  @Delete(':id/rate-card/pending/:approvalId')
  deletePendingLane(
    @Param('id') id: string,
    @Param('approvalId') approvalId: string,
    @Body() dto: DeleteRateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.revisions.deletePendingLane(id, approvalId, dto.reason, user);
  }

  /** Deletes a rate change still waiting for sign-off. Leadership or an administrator only. */
  @Delete(':id/rate-revisions/:revisionId')
  deleteRevision(
    @Param('id') id: string,
    @Param('revisionId') revisionId: string,
    @Body() dto: DeleteRateDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.revisions.deleteRevision(id, revisionId, dto.reason, user);
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
   * Lanes proposed for this client and still waiting for approval. No
   * permission beyond being signed in — the same as `GET :id/rate-card`,
   * which this sits beside on the client page.
   */
  @Get(':id/rate-card/pending')
  pendingLanes(@Param('id') id: string) {
    return this.revisions.pendingLanes(id);
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
