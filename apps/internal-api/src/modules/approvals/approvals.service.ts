import { Injectable } from '@nestjs/common';
import { assertReason, DomainException } from '../../common/domain-exception';
import type { ApprovalDto } from '../../common/approval-required.response';
import { ApprovalRequiredResponse } from '../../common/approval-required.response';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { DbExecutor } from '../../db/kysely';
import { AuditService } from '../audit/audit.service';
import { ApprovalsRepository } from './approvals.repository';
import { ApprovalsRegistry } from './approvals.registry';
import {
  APPROVER_ROLE_LABEL_BY_KIND,
  REQUIRED_PERMISSION_BY_KIND,
  type ApprovalKind,
  type ApprovalPayload,
} from './approvals.types';

interface RaiseInput<TAction> {
  kind: ApprovalKind;
  entityType: string;
  entityId: string;
  reason: string;
  title: string;
  detail: string;
  amountPaise: number | null;
  action: TAction;
}

@Injectable()
export class ApprovalsService {
  constructor(
    private readonly approvalsRepository: ApprovalsRepository,
    private readonly registry: ApprovalsRegistry,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Called by a domain service (indent award, advance release, …) instead of
   * completing its own write, whenever one of the six kinds applies (part 01
   * §3). Returns an `ApprovalRequiredResponse` the calling controller returns
   * as-is — `TransformInterceptor` turns it into `202`.
   */
  async raise<TAction>(
    input: RaiseInput<TAction>,
    actor: AuthenticatedUser,
  ): Promise<ApprovalRequiredResponse> {
    assertReason(input.reason); // REASON_TOO_SHORT, ≥ 20 chars, every kind

    const payload: ApprovalPayload<TAction> = {
      title: input.title,
      detail: input.detail,
      amountPaise: input.amountPaise,
      action: input.action,
    };

    const row = await this.approvalsRepository.transaction().execute(async (trx) => {
      const inserted = await this.approvalsRepository.insert(trx, {
        kind: input.kind,
        entityType: input.entityType,
        entityId: input.entityId,
        requesterId: actor.userId,
        reason: input.reason,
        payload,
      });
      await this.auditService.record(trx, actor, {
        action: 'APPROVAL_RAISED',
        entityType: 'approvals',
        entityId: inserted.id,
        after: { kind: input.kind, entityType: input.entityType, entityId: input.entityId },
      });
      return inserted;
    });

    return new ApprovalRequiredResponse(this.toDto(row, actor.name));
  }

  async list(status: string | undefined, kind: string | undefined): Promise<ApprovalDto[]> {
    const rows = await this.approvalsRepository.list(status, kind);
    return rows.map((row) => {
      const payload = row.payload as unknown as ApprovalPayload;
      return {
        id: row.id,
        kind: row.kind,
        entityType: row.entityType,
        entityId: row.entityId,
        title: payload.title,
        detail: payload.detail,
        amountPaise: payload.amountPaise,
        requesterId: row.requesterId,
        requesterName: row.requesterName,
        approverRole: APPROVER_ROLE_LABEL_BY_KIND[row.kind as ApprovalKind],
        requiredPermission: REQUIRED_PERMISSION_BY_KIND[row.kind as ApprovalKind],
        reason: row.reason,
        status: row.status,
        createdAt: String(row.createdAt),
      };
    });
  }

  /**
   * Pending approvals of one kind against one record, with the action each
   * would replay — for a screen that has to show what is *about* to exist
   * (a proposed rate card lane) rather than only what already does.
   */
  async pendingFor<TAction>(kind: ApprovalKind, entityType: string, entityId: string) {
    const rows = await this.approvalsRepository.list('PENDING', kind);
    return rows
      .filter((r) => r.entityType === entityType && r.entityId === entityId)
      .map((r) => ({
        approvalId: r.id,
        requesterName: r.requesterName,
        createdAt: String(r.createdAt),
        action: (r.payload as unknown as ApprovalPayload<TAction>).action,
      }));
  }

  /**
   * The stored payload is replayed verbatim (part 01 §3) — never
   * recomputed. If the owning wave hasn't registered a handler for this kind
   * yet, or the handler itself rejects a now-stale payload (vendor
   * suspended, indent cancelled), this fails closed with `409` and the
   * transaction that would have flipped the row to `APPROVED` rolls back.
   */
  async approve(id: string, actor: AuthenticatedUser): Promise<ApprovalDto> {
    return this.approvalsRepository.transaction().execute(async (trx) => {
      const row = await this.approvalsRepository.findById(trx, id);
      if (!row) {
        throw new DomainException(404, 'NOT_FOUND', `Unknown approval: ${id}`);
      }
      if (row.status !== 'PENDING') {
        throw new DomainException(409, 'ALREADY_DECIDED', `Approval ${id} is already ${row.status}.`);
      }

      const kind = row.kind as ApprovalKind;
      this.assertCanDecide(kind, actor);

      const payload = row.payload as unknown as ApprovalPayload;
      const handler = this.registry.get(kind, row.entity_type);
      if (!handler) {
        throw new DomainException(
          409,
          'APPROVAL_HANDLER_MISSING',
          `No module has registered a replay handler for ${kind}:${row.entity_type} yet.`,
        );
      }

      await handler(payload.action, {
        db: trx,
        approvalId: id,
        entityType: row.entity_type,
        entityId: row.entity_id,
        approverId: actor.userId,
        approverName: actor.name,
        approverRole: actor.role,
      });

      const decided = await this.approvalsRepository.decide(trx, id, 'APPROVED', actor.userId, null);
      await this.auditService.record(trx, actor, {
        action: 'APPROVAL_APPROVED',
        entityType: 'approvals',
        entityId: id,
      });

      return this.toDto(decided, actor.name);
    });
  }

  async reject(id: string, note: string, actor: AuthenticatedUser): Promise<ApprovalDto> {
    if (!note || note.trim().length === 0) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'A note is required to reject an approval.');
    }

    return this.approvalsRepository.transaction().execute(async (trx) => {
      const row = await this.approvalsRepository.findById(trx, id);
      if (!row) {
        throw new DomainException(404, 'NOT_FOUND', `Unknown approval: ${id}`);
      }
      if (row.status !== 'PENDING') {
        throw new DomainException(409, 'ALREADY_DECIDED', `Approval ${id} is already ${row.status}.`);
      }
      this.assertCanDecide(row.kind as ApprovalKind, actor);

      await this.runRejection(trx, row, actor);
      const decided = await this.approvalsRepository.decide(trx, id, 'REJECTED', actor.userId, note);
      // NFR-03: the requester is notified — part 13's notification dispatch
      // (C10) owns delivery; this only records the fact for now.
      await this.auditService.record(trx, actor, {
        action: 'APPROVAL_REJECTED',
        entityType: 'approvals',
        entityId: id,
        after: { note },
      });

      return this.toDto(decided, actor.name);
    });
  }

  /**
   * Takes a pending request off the queue without deciding it on its merits —
   * a duplicate rate removed by Leadership or an administrator. Recorded as
   * REJECTED with the note, so the history still shows it was asked for. The
   * caller decides who may do this; the row must match the kind and entity the
   * caller names, so an id from one screen cannot withdraw another's request.
   */
  async withdraw(
    id: string,
    note: string,
    actor: AuthenticatedUser,
    expect: { kind: ApprovalKind; entityType: string; entityId: string },
  ): Promise<ApprovalDto> {
    return this.approvalsRepository.transaction().execute(async (trx) => {
      const row = await this.approvalsRepository.findById(trx, id);
      if (!row || row.kind !== expect.kind || row.entity_type !== expect.entityType || row.entity_id !== expect.entityId) {
        throw new DomainException(404, 'NOT_FOUND', `Unknown request: ${id}`);
      }
      if (row.status !== 'PENDING') {
        throw new DomainException(409, 'ALREADY_DECIDED', `That request is already ${row.status.toLowerCase()}.`);
      }
      await this.runRejection(trx, row, actor);
      const decided = await this.approvalsRepository.decide(trx, id, 'REJECTED', actor.userId, note);
      await this.auditService.record(trx, actor, {
        action: 'APPROVAL_WITHDRAWN',
        entityType: 'approvals',
        entityId: id,
        after: { note },
      });
      return this.toDto(decided, actor.name);
    });
  }

  /**
   * `requiredPermission` varies per kind (`REQUIRED_PERMISSION_BY_KIND`), so
   * a static `@RequirePermission(...)` on the controller route can't express
   * it — the check has to happen here, once the row's `kind` is known.
   */
  /** The owning module's tidy-up for a turned-down request, when it registered one. Same transaction. */
  private async runRejection(
    trx: DbExecutor,
    row: { id: string; kind: string; entity_type: string; entity_id: string; payload: unknown },
    actor: AuthenticatedUser,
  ): Promise<void> {
    const handler = this.registry.getRejection(row.kind as ApprovalKind, row.entity_type);
    if (!handler) return;
    await handler((row.payload as ApprovalPayload).action, {
      db: trx,
      approvalId: row.id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      approverId: actor.userId,
      approverName: actor.name,
      approverRole: actor.role,
    });
  }

  private assertCanDecide(kind: ApprovalKind, actor: AuthenticatedUser): void {
    const required = REQUIRED_PERMISSION_BY_KIND[kind];
    if (actor.permissions.get(required) !== 'EDIT') {
      throw new DomainException(403, 'PERMISSION_DENIED', `Missing permission: ${required}.`);
    }
  }

  private toDto(
    row: {
      id: string;
      kind: string;
      entity_type: string;
      entity_id: string;
      payload: unknown;
      requester_id: string;
      reason: string;
      status: string;
      created_at: string;
    },
    requesterName: string,
  ): ApprovalDto {
    const payload = row.payload as ApprovalPayload;
    return {
      id: row.id,
      kind: row.kind,
      entityType: row.entity_type,
      entityId: row.entity_id,
      title: payload.title,
      detail: payload.detail,
      amountPaise: payload.amountPaise,
      requesterId: row.requester_id,
      requesterName,
      approverRole: APPROVER_ROLE_LABEL_BY_KIND[row.kind as ApprovalKind],
      requiredPermission: REQUIRED_PERMISSION_BY_KIND[row.kind as ApprovalKind],
      reason: row.reason,
      status: row.status,
      createdAt: String(row.created_at),
    };
  }
}
