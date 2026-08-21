import { Injectable } from '@nestjs/common';
import { assertReason, DomainException } from '../../common/domain-exception';
import type { ApprovalDto } from '../../common/approval-required.response';
import { ApprovalRequiredResponse } from '../../common/approval-required.response';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
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
   * `requiredPermission` varies per kind (`REQUIRED_PERMISSION_BY_KIND`), so
   * a static `@RequirePermission(...)` on the controller route can't express
   * it — the check has to happen here, once the row's `kind` is known.
   */
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
