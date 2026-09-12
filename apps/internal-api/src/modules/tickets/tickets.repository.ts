import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

/**
 * The column unions rather than `string`.
 *
 * Kysely will not compare an enum column against a bare string, and that is
 * worth keeping: a filter typed `string` accepts `'RESOLVE'` for `'RESOLVED'`
 * and answers with an empty list, which reads as "nothing to do".
 */
type TicketRow = {
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'WONT_FIX';
  kind: 'WRONG_DATA' | 'MISSING_DATA' | 'ACCESS' | 'HOW_DO_I' | 'OTHER';
  severity: 'BLOCKING' | 'NORMAL' | 'MINOR';
};

export interface TicketFilters {
  status?: TicketRow['status'];
  kind?: TicketRow['kind'];
  severity?: TicketRow['severity'];
  /** Set when the caller cannot read the whole queue — their own reports only. */
  raisedBy?: string;
  entityType?: string;
  entityId?: string;
  q?: string;
}

@Injectable()
export class TicketsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  private base(f: TicketFilters) {
    let query = this.db
      .selectFrom('tickets')
      .leftJoin('users as raiser', 'raiser.id', 'tickets.raised_by')
      .leftJoin('users as resolver', 'resolver.id', 'tickets.resolved_by')
      .leftJoin('branches', 'branches.id', 'tickets.branch_id');

    if (f.status) query = query.where('tickets.status', '=', f.status);
    if (f.kind) query = query.where('tickets.kind', '=', f.kind);
    if (f.severity) query = query.where('tickets.severity', '=', f.severity);
    // Applied by the service, never by the caller — this is the scoping that
    // keeps one desk out of another's reports.
    if (f.raisedBy) query = query.where('tickets.raised_by', '=', f.raisedBy);
    if (f.entityType) query = query.where('tickets.entity_type', '=', f.entityType);
    if (f.entityId) query = query.where('tickets.entity_id', '=', f.entityId);
    if (f.q) {
      const term = `%${f.q}%`;
      query = query.where((eb) =>
        eb.or([eb('tickets.code', 'ilike', term), eb('tickets.subject', 'ilike', term)]),
      );
    }
    return query;
  }

  list(f: TicketFilters) {
    return this.base(f)
      .select([
        'tickets.id as id',
        'tickets.code as code',
        'tickets.subject as subject',
        'tickets.detail as detail',
        'tickets.kind as kind',
        'tickets.severity as severity',
        'tickets.status as status',
        'tickets.raised_on_path as raisedOnPath',
        'tickets.entity_type as entityType',
        'tickets.entity_id as entityId',
        'tickets.resolution as resolution',
        'tickets.resolved_at as resolvedAt',
        'tickets.created_at as createdAt',
        'tickets.raised_by as raisedBy',
        'raiser.name as raisedByName',
        'resolver.name as resolvedByName',
        'branches.name as branchName',
      ])
      /*
       * Blocking first, then oldest. Somebody who cannot get on with their job
       * outranks a typo raised this morning, and within a severity the thing
       * that has waited longest is the thing to do next.
       */
      .orderBy((eb) => eb.case().when('tickets.severity', '=', 'BLOCKING').then(0).else(1).end())
      .orderBy('tickets.created_at', 'asc')
      .execute();
  }

  findById(id: string) {
    return this.base({}).where('tickets.id', '=', id).selectAll('tickets').executeTakeFirst();
  }

  findByIdForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('tickets').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  insert(
    db: DbExecutor,
    row: {
      code: string;
      subject: string;
      detail: string;
      kind: TicketRow['kind'];
      severity: TicketRow['severity'];
      raised_on_path: string;
      entity_type: string | null;
      entity_id: string | null;
      raised_by: string;
      branch_id: string | null;
    },
  ) {
    return db.insertInto('tickets').values(row).returningAll().executeTakeFirstOrThrow();
  }

  update(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db
      .updateTable('tickets')
      .set({ ...patch, updated_at: new Date().toISOString() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
