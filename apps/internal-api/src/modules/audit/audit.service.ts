import { Injectable } from '@nestjs/common';
import type { DbExecutor } from '../../db/kysely';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

export interface AuditEventInput {
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  requestId?: string;
}

/**
 * NFR-03: every mutation writes an `audit_events` row inside the same
 * transaction that made the change. Immutability is enforced at the database
 * (part 01 §8, migration `20260814090000`/`…090200`) — `internal_api` holds
 * no `UPDATE`/`DELETE` grant on the table and a trigger raises regardless —
 * so this service only ever inserts.
 *
 * Takes a `DbExecutor` rather than injecting `INTERNAL_DB` itself: a caller
 * that fetches `INTERNAL_DB` for its own write and calls
 * `db.transaction().execute(trx => ...)` must pass that same `trx` here, or
 * the audit row lands outside the transaction it is meant to describe.
 */
@Injectable()
export class AuditService {
  async record(
    db: DbExecutor,
    // Narrowed to what this actually reads: an approval-replay handler only
    // has `ctx.approverId`/`approverRole` (approvals.types.ts), not a full
    // `AuthenticatedUser` — a full principal still satisfies this.
    actor: Pick<AuthenticatedUser, 'userId' | 'role'>,
    event: AuditEventInput,
  ): Promise<void> {
    await db
      .insertInto('audit_events')
      .values({
        actor_id: actor.userId,
        actor_role: actor.role,
        actor_vendor_id: null,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId ?? null,
        before: event.before === undefined ? null : (event.before as never),
        after: event.after === undefined ? null : (event.after as never),
        request_id: event.requestId ?? null,
      })
      .execute();
  }

  /** For the one writer that is not an internal principal: the portal surface (ADR-02 §7). */
  async recordPortalEvent(
    db: DbExecutor,
    vendorId: string,
    event: AuditEventInput,
  ): Promise<void> {
    await db
      .insertInto('audit_events')
      .values({
        actor_id: null,
        actor_role: 'PORTAL',
        actor_vendor_id: vendorId,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId ?? null,
        before: event.before === undefined ? null : (event.before as never),
        after: event.after === undefined ? null : (event.after as never),
        request_id: event.requestId ?? null,
      })
      .execute();
  }

  /**
   * For the other writer with no human behind it: an unattended background
   * job (`modules/jobs`). `jobName` (e.g. `POD_AGEING_JOB`) fills the same
   * `actor_role` slot `recordPortalEvent` gives `'PORTAL'` — the audit trail
   * still needs to say *what* changed a row even when nobody was signed in.
   */
  async recordSystemEvent(
    db: DbExecutor,
    jobName: string,
    event: AuditEventInput,
  ): Promise<void> {
    await db
      .insertInto('audit_events')
      .values({
        actor_id: null,
        actor_role: jobName,
        actor_vendor_id: null,
        action: event.action,
        entity_type: event.entityType,
        entity_id: event.entityId ?? null,
        before: event.before === undefined ? null : (event.before as never),
        after: event.after === undefined ? null : (event.after as never),
        request_id: event.requestId ?? null,
      })
      .execute();
  }
}
