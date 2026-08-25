import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

@Injectable()
export class IssuesRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  list() {
    return this.db
      .selectFrom('issues')
      .innerJoin('vendors', 'vendors.id', 'issues.vendor_id')
      .innerJoin('users', 'users.id', 'issues.raised_by')
      .leftJoin('trips', 'trips.id', 'issues.trip_id')
      .select([
        'issues.id as id',
        'issues.code as code',
        'issues.vendor_id as vendorId',
        'vendors.legal_name as vendorName',
        'issues.category as category',
        'issues.severity as severity',
        'trips.code as tripCode',
        'users.name as raisedBy',
        'issues.raised_at as raisedAt',
        'issues.status as status',
        'issues.note as note',
      ])
      .orderBy('issues.raised_at', 'desc')
      .execute();
  }

  findById(id: string) {
    return this.db.selectFrom('issues').selectAll().where('id', '=', id).executeTakeFirst();
  }

  findTripIdByCode(code: string) {
    return this.db.selectFrom('trips').select('id').where('code', '=', code).executeTakeFirst();
  }

  insert(
    db: DbExecutor,
    row: {
      code: string;
      vendorId: string;
      category: string;
      severity: string;
      raisedBy: string;
      tripId: string | null;
      note: string | null;
    },
  ) {
    return db
      .insertInto('issues')
      .values({
        code: row.code,
        vendor_id: row.vendorId,
        category: row.category,
        severity: row.severity,
        raised_by: row.raisedBy,
        trip_id: row.tripId,
        note: row.note,
        status: 'OPEN',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  update(id: string, patch: Record<string, unknown>) {
    return this.db.updateTable('issues').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
}
