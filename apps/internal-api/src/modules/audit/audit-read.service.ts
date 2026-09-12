import { Injectable } from '@nestjs/common';
import { AuditRepository, type AuditQuery } from './audit.repository';
import { actionLabel, changedFields, describe, entityLabel } from './audit-labels';

/**
 * Reading the audit trail — "transactions check" and "legitimacy of
 * operations", which the owner's notes put on Finance and which the app has
 * never had a surface for.
 *
 * Separate from `AuditService` on purpose. That one writes, is `@Global`, and
 * is injected into nearly every module; nothing that writes the trail should
 * carry the ability to query it around with it. Two classes, one direction
 * each.
 */
@Injectable()
export class AuditReadService {
  constructor(private readonly auditRepository: AuditRepository) {}

  async list(filters: Partial<AuditQuery> & { limit?: number; offset?: number }) {
    /*
     * Capped at 200. The trail only ever grows, and an uncapped page against a
     * table with no upper bound is how a review screen becomes the slowest
     * query in the system a year after anybody looked at it.
     */
    const query: AuditQuery = {
      ...filters,
      limit: Math.min(Math.max(filters.limit ?? 50, 1), 200),
      offset: Math.max(filters.offset ?? 0, 0),
    };

    const [rows, total] = await Promise.all([
      this.auditRepository.list(query),
      this.auditRepository.count(query),
    ]);

    return {
      total,
      limit: query.limit,
      offset: query.offset,
      events: rows.map((r) => ({
        id: r.id,
        at: r.at,
        actorId: r.actorId,
        actorName: r.actorName,
        actorRole: r.actorRole,
        /*
         * A vendor acting through the transporter portal, rather than one of
         * our own desks. Surfaced rather than flattened into the actor name,
         * because "was this done by us or by them" is the first question asked
         * of a disputed entry.
         */
        byVendor: r.actorVendorId !== null,
        action: r.action,
        actionLabel: actionLabel(r.action),
        entityType: r.entityType,
        entityLabel: entityLabel(r.entityType),
        entityId: r.entityId,
        summary: describe({
          actorName: r.actorName,
          actorRole: r.actorRole,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
        }),
        changed: changedFields(r.before, r.after),
        before: r.before,
        after: r.after,
      })),
    };
  }

  /** Everything that has happened to one record, oldest last — its whole life. */
  async forEntity(entityType: string, entityId: string) {
    return this.list({ entityType, entityId, limit: 200 });
  }

  /** What the filters should offer, read from what is actually in the trail. */
  async filterOptions() {
    const [actions, entityTypes] = await Promise.all([
      this.auditRepository.actions(),
      this.auditRepository.entityTypes(),
    ]);
    return {
      actions: actions.map((code) => ({ code, label: actionLabel(code) })),
      entityTypes: entityTypes.map((code) => ({ code, label: entityLabel(code) })),
    };
  }
}
