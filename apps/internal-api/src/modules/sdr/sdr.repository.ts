import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

export interface SdrListFilters {
  status?: string;
  vendorId?: string;
  tripId?: string;
}

@Injectable()
export class SdrRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  private baseQuery(db: DbExecutor) {
    return db
      .selectFrom('sdr_records')
      .innerJoin('trips', 'trips.id', 'sdr_records.trip_id')
      .innerJoin('vendors', 'vendors.id', 'sdr_records.vendor_id')
      .innerJoin('users as raiser', 'raiser.id', 'sdr_records.raised_by')
      .leftJoin('users as resolver', 'resolver.id', 'sdr_records.resolved_by')
      .select([
        'sdr_records.id as id',
        'sdr_records.code as code',
        'sdr_records.trip_id as tripId',
        'trips.code as tripCode',
        'sdr_records.vendor_id as vendorId',
        'vendors.legal_name as vendorName',
        'sdr_records.kind as kind',
        'sdr_records.description as description',
        'sdr_records.claimed_amount as claimedPaise',
        'sdr_records.status as status',
        'sdr_records.deduction as deductionPaise',
        'sdr_records.outstanding as outstandingPaise',
        'sdr_records.waived as waivedPaise',
        'sdr_records.resolution_note as resolutionNote',
        'raiser.name as raisedByName',
        'sdr_records.raised_at as raisedAt',
        'resolver.name as resolvedByName',
        'sdr_records.resolved_at as resolvedAt',
      ]);
  }

  list(filters: SdrListFilters) {
    let query = this.baseQuery(this.db);
    if (filters.status) query = query.where('sdr_records.status', '=', filters.status);
    if (filters.vendorId) query = query.where('sdr_records.vendor_id', '=', filters.vendorId);
    if (filters.tripId) query = query.where('sdr_records.trip_id', '=', filters.tripId);
    return query.orderBy('sdr_records.raised_at', 'desc').execute();
  }

  get(id: string) {
    return this.findById(this.db, id);
  }

  findById(db: DbExecutor, id: string) {
    return this.baseQuery(db).where('sdr_records.id', '=', id).executeTakeFirst();
  }

  findByIdForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('sdr_records').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  }

  insert(
    db: DbExecutor,
    row: {
      code: string;
      tripId: string;
      vendorId: string;
      kind: string;
      description: string;
      claimedPaise: number;
      raisedBy: string;
    },
  ) {
    return db
      .insertInto('sdr_records')
      .values({
        code: row.code,
        trip_id: row.tripId,
        vendor_id: row.vendorId,
        kind: row.kind,
        description: row.description,
        claimed_amount: row.claimedPaise,
        raised_by: row.raisedBy,
      })
      .returning(['id', 'code'])
      .executeTakeFirstOrThrow();
  }

  resolve(db: DbExecutor, id: string, patch: { deductionPaise: number; note: string | null; resolvedBy: string }) {
    return db
      .updateTable('sdr_records')
      .set({
        status: 'RESOLVED',
        deduction: patch.deductionPaise,
        outstanding: patch.deductionPaise,
        resolution_note: patch.note,
        resolved_by: patch.resolvedBy,
        resolved_at: new Date().toISOString(),
      })
      .where('id', '=', id)
      .where('status', '=', 'OPEN')
      .executeTakeFirst();
  }

  /** Which trips' payments each record has been recovered from, oldest first. */
  recoveriesFor(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([] as { sdrId: string; tripId: string; tripCode: string; amountPaise: number; at: string }[]);
    return this.db
      .selectFrom('sdr_recoveries')
      .innerJoin('trips', 'trips.id', 'sdr_recoveries.trip_id')
      .select([
        'sdr_recoveries.sdr_id as sdrId',
        'sdr_recoveries.trip_id as tripId',
        'trips.code as tripCode',
        'sdr_recoveries.amount as amountPaise',
        'sdr_recoveries.created_at as at',
      ])
      .where('sdr_recoveries.sdr_id', 'in', ids)
      .orderBy('sdr_recoveries.created_at')
      .execute();
  }

  /** The unrecovered remainder written off; returns what it was. */
  async waiveOutstanding(db: DbExecutor, id: string): Promise<number> {
    const row = await db.selectFrom('sdr_records').select('outstanding').where('id', '=', id).forUpdate().executeTakeFirstOrThrow();
    const amount = Number(row.outstanding);
    await db
      .updateTable('sdr_records')
      .set((eb) => ({ outstanding: 0, waived: eb('waived', '+', amount) }))
      .where('id', '=', id)
      .execute();
    return amount;
  }

  insertWaiver(
    db: DbExecutor,
    row: { tripId: string; sdrId: string; amount: number; mailSubject: string; mailAttachmentId: string | null; note: string | null; waivedBy: string },
  ) {
    return db
      .insertInto('penalty_waivers')
      .values({
        kind: 'SDR_RECOVERY',
        trip_id: row.tripId,
        sdr_id: row.sdrId,
        amount: row.amount,
        mail_subject: row.mailSubject,
        mail_attachment_id: row.mailAttachmentId,
        note: row.note,
        waived_by: row.waivedBy,
      })
      .execute();
  }

  /** What a transporter still owes us across every resolved record: their negative balance. */
  async recoverableFor(vendorId: string): Promise<number> {
    const row = await this.db
      .selectFrom('sdr_records')
      .select((eb) => eb.fn.sum<number>('outstanding').as('total'))
      .where('vendor_id', '=', vendorId)
      .where('status', '=', 'RESOLVED')
      .executeTakeFirst();
    return Number(row?.total ?? 0);
  }

  async countOpenForTrip(db: DbExecutor, tripId: string): Promise<number> {
    const row = await db
      .selectFrom('sdr_records')
      .select((eb) => eb.fn.countAll<number>().as('c'))
      .where('trip_id', '=', tripId)
      .where('status', '=', 'OPEN')
      .executeTakeFirstOrThrow();
    return Number(row.c);
  }

  /** Resolved records for this transporter that still have something to take. */
  outstandingForVendor(db: DbExecutor, vendorId: string, lock = false) {
    let query = db
      .selectFrom('sdr_records')
      .innerJoin('trips', 'trips.id', 'sdr_records.trip_id')
      .select([
        'sdr_records.id as id',
        'sdr_records.code as code',
        'sdr_records.trip_id as tripId',
        'trips.code as tripCode',
        'sdr_records.outstanding as outstandingPaise',
        'sdr_records.resolved_at as resolvedAt',
      ])
      .where('sdr_records.vendor_id', '=', vendorId)
      .where('sdr_records.status', '=', 'RESOLVED')
      .where('sdr_records.outstanding', '>', 0);
    if (lock) query = query.forUpdate('sdr_records');
    return query.execute();
  }

  reduceOutstanding(db: DbExecutor, id: string, by: number) {
    return db
      .updateTable('sdr_records')
      .set((eb) => ({ outstanding: eb('outstanding', '-', by) }))
      .where('id', '=', id)
      .execute();
  }

  insertRecovery(db: DbExecutor, row: { sdrId: string; tripId: string; paymentId: string; amountPaise: number }) {
    return db
      .insertInto('sdr_recoveries')
      .values({ sdr_id: row.sdrId, trip_id: row.tripId, payment_id: row.paymentId, amount: row.amountPaise })
      .execute();
  }

  async summary() {
    const rows = await this.db
      .selectFrom('sdr_records')
      .select((eb) => [
        eb.fn.countAll<number>().filterWhere('status', '=', 'OPEN').as('open'),
        eb.fn.countAll<number>().filterWhere('status', '=', 'RESOLVED').as('resolved'),
        eb.fn.sum<number>('outstanding').as('outstanding'),
      ])
      .executeTakeFirstOrThrow();
    return {
      open: Number(rows.open),
      resolved: Number(rows.resolved),
      outstandingPaise: Number(rows.outstanding ?? 0),
    };
  }
}
