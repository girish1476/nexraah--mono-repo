import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { TicketsService } from './tickets.service';
import { RaiseTicketDto, UpdateTicketDto } from './tickets.dto';

/**
 * Tickets — raised by anyone, answered by Administration.
 *
 * Note what is NOT gated: `POST /tickets` carries no `@RequirePermission`, and
 * that is the design rather than an omission. Ticketing is on every dashboard
 * because the person who spots wrong data is whoever was using the screen; a
 * report queue only some desks can add to fills up with nothing.
 *
 * `GET` is ungated for the same reason and scoped in the service instead —
 * somebody without `ticket.resolve` gets their own reports, which is a
 * narrowing the caller cannot widen from the query string.
 */
@Controller('tickets')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('kind') kind?: string,
    @Query('severity') severity?: string,
    @Query('q') q?: string,
    @Query('mine') mine?: string,
  ) {
    return this.tickets.list({ status, kind, severity, q, mine: mine === '1' }, user);
  }

  @Get(':id')
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.getById(id, user);
  }

  /** No permission — see the class comment. Anyone signed in may report a problem. */
  @Post()
  raise(@Body() dto: RaiseTicketDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tickets.raise(dto, user);
  }

  /**
   * The "edit options if any wrong data was updated" half: picking a report
   * up, closing it with what was done, or reopening one closed by mistake.
   */
  @Patch(':id')
  @RequirePermission('ticket.resolve')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.tickets.update(id, dto, user);
  }
}
