import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { SupabaseJwtGuard } from '../../common/guards/supabase-jwt.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { AuditReadService } from './audit-read.service';

/**
 * The audit trail, readable at last.
 *
 * Every route is a GET and there is no write route, because there cannot be
 * one: `internal_api` holds no UPDATE or DELETE grant on `audit_events` and a
 * trigger raises regardless. Nothing here can alter or hide an entry, which is
 * the only property that makes a trail worth reading.
 *
 * Gated whole on `audit.view` — held by Finance (whose named job this is),
 * Leadership (oversight) and Admin. Applied at the class so a route added
 * later cannot be forgotten: the two unguarded controllers found in the
 * 2026-08-25 audit were both cases of a per-method decorator simply not being
 * typed.
 */
@Controller('audit')
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
@RequirePermission('audit.view', 'VIEW')
export class AuditController {
  constructor(private readonly auditRead: AuditReadService) {}

  /**
   * Declared before `:entityType/:entityId` — otherwise `/audit/filters` is
   * read as a request for entity type "filters".
   */
  @Get('filters')
  filters() {
    return this.auditRead.filterOptions();
  }

  @Get()
  list(
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.auditRead.list({
      actorId,
      action,
      entityType,
      entityId,
      from,
      to,
      // Query strings arrive as text; `Number(undefined)` is NaN, so both are
      // left undefined rather than coerced into a NaN the service would have
      // to defend against.
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
    });
  }

  /** Everything that has ever happened to one record — an invoice, a trip, a payment. */
  @Get(':entityType/:entityId')
  forEntity(@Param('entityType') entityType: string, @Param('entityId') entityId: string) {
    return this.auditRead.forEntity(entityType, entityId);
  }
}
