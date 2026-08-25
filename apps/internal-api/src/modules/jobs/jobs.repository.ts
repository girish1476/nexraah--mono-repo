import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

@Injectable()
export class JobsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  /** `notification-dispatch` — no real provider exists yet (documented, human-gated); this just clears the queue. */
  dispatchPending(db: DbExecutor) {
    return db
      .updateTable('notifications')
      .set({ status: 'SENT', sent_at: new Date().toISOString() })
      .where('status', '=', 'PENDING')
      .returning('id')
      .execute();
  }

  insertNotification(
    db: DbExecutor,
    row: { event: string; channel: string; recipient: string; template_id: string; payload: unknown },
  ) {
    return db
      .insertInto('notifications')
      .values({ ...row, payload: row.payload as never, status: 'PENDING' })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** `forfeiture-report` — trips this job's own `pod-ageing` run forfeited in the last calendar month, by vendor. */
  forfeitedTripsPastMonth() {
    const since = new Date();
    since.setMonth(since.getMonth() - 1);
    return this.db
      .selectFrom('trips')
      .innerJoin('vendors', 'vendors.id', 'trips.vendor_id')
      .select(['trips.vendor_id as vendorId', 'vendors.legal_name as vendorName', 'trips.id as tripId', 'trips.code as tripCode', 'trips.buy_rate as buyRatePaise'])
      .where('trips.pod_closure_basis', '=', 'FORFEITED')
      .where('trips.updated_at', '>=', since.toISOString())
      .execute();
  }
}
