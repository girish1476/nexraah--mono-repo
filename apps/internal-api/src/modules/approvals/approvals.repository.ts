import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { ApprovalKind } from './approvals.types';

@Injectable()
export class ApprovalsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  async insert(
    db: DbExecutor,
    row: {
      kind: ApprovalKind;
      entityType: string;
      entityId: string;
      requesterId: string;
      reason: string;
      payload: unknown;
    },
  ) {
    return db
      .insertInto('approvals')
      .values({
        kind: row.kind,
        entity_type: row.entityType,
        entity_id: row.entityId,
        requester_id: row.requesterId,
        reason: row.reason,
        payload: JSON.stringify(row.payload),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(db: DbExecutor, id: string) {
    return db.selectFrom('approvals').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  async list(status: string | undefined, kind: string | undefined) {
    let query = this.db
      .selectFrom('approvals')
      .innerJoin('users', 'users.id', 'approvals.requester_id')
      .select([
        'approvals.id as id',
        'approvals.kind as kind',
        'approvals.entity_type as entityType',
        'approvals.entity_id as entityId',
        'approvals.payload as payload',
        'approvals.requester_id as requesterId',
        'users.name as requesterName',
        'approvals.reason as reason',
        'approvals.status as status',
        'approvals.created_at as createdAt',
      ])
      .orderBy('approvals.created_at', 'desc');

    query = query.where('approvals.status', '=', status ?? 'PENDING');
    if (kind) {
      query = query.where('approvals.kind', '=', kind);
    }
    return query.execute();
  }

  async decide(
    db: DbExecutor,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    approverId: string,
    note: string | null,
  ) {
    return db
      .updateTable('approvals')
      .set({ status, approver_id: approverId, decided_at: new Date().toISOString(), note })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
