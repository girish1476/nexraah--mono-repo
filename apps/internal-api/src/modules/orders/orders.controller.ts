import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { OrdersService } from './orders.service';

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
    @Query('status') status?: string,
    @Query('branch') branchId?: string,
    @Query('client') clientId?: string,
    @Query('open') open?: string,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    // Paging is capped rather than trusted. The screen this replaces had no
    // paging at all and pulled every row, so an unbounded `limit` here would
    // reintroduce exactly the problem the endpoint exists to fix.
    const parsedLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const parsedOffset = Math.max(Number(offset) || 0, 0);
    return this.orders.list({
      status,
      branchId,
      clientId,
      openOnly: open === '1' || open === 'true',
      q,
      limit: parsedLimit,
      offset: parsedOffset,
    });
  }

  /** Counts per step, for the phase tabs — one round trip, not one per tab. */
  @Get('counts')
  @RequirePermission('indent.view')
  counts(@Query('branch') branchId?: string) {
    return this.orders.counts(branchId);
  }

  @Get(':id')
  @RequirePermission('indent.view')
  getById(@Param('id') id: string) {
    return this.orders.getById(id);
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
