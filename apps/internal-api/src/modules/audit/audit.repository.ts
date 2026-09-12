import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';

export interface AuditQuery {
  actorId?: string;
  action?: string;
  entityType?: string;
  entityId?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

/**
 * Reading the trail.
 *
 * Read-only by construction, not by convention: `internal_api` holds no
 * UPDATE or DELETE grant on `audit_events` and a trigger raises regardless
 * (`20260814090000`). There is deliberately no write method on this class —
 * writing is `AuditService.record()`'s job, inside the transaction it
 * describes.
 */
@Injectable()
export class AuditRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  private filtered(q: AuditQuery) {
    let query = this.db
      .selectFrom('audit_events')
      .leftJoin('users', 'users.id', 'audit_events.actor_id');

    if (q.actorId) query = query.where('audit_events.actor_id', '=', q.actorId);
    if (q.action) query = query.where('audit_events.action', '=', q.action);
    if (q.entityType) query = query.where('audit_events.entity_type', '=', q.entityType);
    if (q.entityId) query = query.where('audit_events.entity_id', '=', q.entityId);
    if (q.from) query = query.where('audit_events.at', '>=', q.from);
    // Inclusive of the whole `to` day: somebody asking for "up to the 26th"
    // means the 26th included, and a bare date parses as midnight.
    if (q.to) query = query.where('audit_events.at', '<', `${q.to}T23:59:59.999Z`);

    return query;
  }

  list(q: AuditQuery) {
    return this.filtered(q)
      .select([
        'audit_events.id as id',
        'audit_events.at as at',
        'audit_events.actor_id as actorId',
        'audit_events.actor_role as actorRole',
        'audit_events.actor_vendor_id as actorVendorId',
        'audit_events.action as action',
        'audit_events.entity_type as entityType',
        'audit_events.entity_id as entityId',
        'audit_events.before as before',
        'audit_events.after as after',
        'users.name as actorName',
      ])
      .orderBy('audit_events.at', 'desc')
      // A tiebreak on id, because two rows written inside one transaction
      // share `at` to the microsecond and an unstable sort would shuffle them
      // between pages — the classic way a paged log silently skips a row.
      .orderBy('audit_events.id', 'desc')
      .limit(q.limit)
      .offset(q.offset)
      .execute();
  }

  async count(q: AuditQuery): Promise<number> {
    const row = await this.filtered(q)
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  /** The distinct actions present, so the filter offers what exists rather than a guess. */
  async actions(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('audit_events')
      .select('action')
      .distinct()
      .orderBy('action')
      .execute();
    return rows.map((r) => r.action);
  }

  async entityTypes(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('audit_events')
      .select('entity_type as entityType')
      .distinct()
      .orderBy('entity_type')
      .execute();
    return rows.map((r) => r.entityType);
  }
}
