import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { IsString, MaxLength } from 'class-validator';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OrdersService } from './orders.service';
import type { OrderSearchFilters } from './orders.repository';

/** The search fields a list request may carry, all optional free text. */
interface OrderSearchQuery {
  status?: string;
  branch?: string;
  client?: string;
  open?: string;
  q?: string;
  clientName?: string;
  vendor?: string;
  from?: string;
  to?: string;
  truck?: string;
  ref?: string;
  branchName?: string;
}

export class AddOrderCommentDto {
  @IsString() @MaxLength(2000) body!: string;
}

/** A query value is only text when it is one string — `?q=a&q=b` arrives as an array. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 100) : undefined;
}

function searchFilters(query: OrderSearchQuery): OrderSearchFilters {
  return {
    status: text(query.status),
    branchId: text(query.branch),
    clientId: text(query.client),
    openOnly: query.open === '1' || query.open === 'true',
    q: text(query.q),
    clientName: text(query.clientName),
    vendor: text(query.vendor),
    from: text(query.from),
    to: text(query.to),
    truck: text(query.truck),
    ref: text(query.ref),
    branchName: text(query.branchName),
  };
}

/**
 * Orders — the ten-step spine, read-only.
 *
 * There is no write endpoint here on purpose. An order's step is a
 * consequence of what happened to its indent, trip, documents and payments;
 * letting anyone PATCH it directly would create a second way for the status
 * to become true, and the whole point of this module is that there is one.
 * Movement happens by doing the underlying thing, and `recompute()` follows.
 *
 * `indent.view` gates reading: every internal role that can see an indent can
 * see where its order stands, which matches the old derived screen (it was
 * built from `/indents` + `/trips` + `/invoices`, so it was already available
 * to anyone holding those).
 */
@Controller('orders')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermission('indent.view')
  list(
    @Query() query: OrderSearchQuery,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Paging is capped rather than trusted. The screen this replaces had no
    // paging at all and pulled every row, so an unbounded `limit` here would
    // reintroduce exactly the problem the endpoint exists to fix.
    const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const parsedOffset = Math.max(Number(offset) || 0, 0);
    return this.orders.list({ ...searchFilters(query), limit: parsedLimit, offset: parsedOffset });
  }

  /**
   * Counts per step, for the phase tabs — one round trip, not one per tab.
   * Takes the list's own search fields, so the tabs describe the orders the
   * search found rather than every order there is. `status` is ignored here.
   */
  @Get('counts')
  @RequirePermission('indent.view')
  counts(@Query() query: OrderSearchQuery) {
    return this.orders.counts(searchFilters(query));
  }

  @Get(':id')
  @RequirePermission('indent.view')
  getById(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.getById(id, user);
  }

  /**
   * Add a comment to an order. The one write here, and it does not touch the
   * order's step — a comment is a note beside the record, not part of it.
   * Anyone who can read the order can comment on it.
   */
  @Post(':id/comments')
  @RequirePermission('indent.view')
  addComment(@Param('id') id: string, @Body() body: AddOrderCommentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.orders.addComment(id, body.body, user);
  }

  /**
   * Recompute one order from its underlying records.
   *
   * Not a way to set a status — it only re-derives one. It exists so a screen
   * can refresh an order after acting on the trip or the payment behind it
   * without waiting for the next scheduled sweep, and so the backfilled rows
   * from the migration can be walked forward on demand.
   */
  @Post(':id/recompute')
  @RequirePermission('indent.view')
  async recompute(@Param('id') id: string) {
    const order = await this.orders.getById(id);
    return this.orders.recompute(order.indentId);
  }

  /**
   * Repair pass: create orders for indents that have none, and compute the
   * ladder for rows that have never been computed.
   *
   * Gated on `config.manage` rather than `indent.view` — it is an
   * administrative sweep over the whole table, not a read. Idempotent, so a
   * scheduled caller can run it as often as it likes.
   */
  @Post('reconcile')
  @RequirePermission('config.manage')
  reconcile(@Query('limit') limit?: string) {
    return this.orders.reconcile(Math.min(Math.max(Number(limit) || 500, 1), 5000));
  }
}
