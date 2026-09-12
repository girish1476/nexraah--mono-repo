import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { RateCardLanesTable } from '../../db/types';

@Injectable()
export class ClientsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  list(q?: string) {
    let query = this.db.selectFrom('clients').selectAll().orderBy('name');
    if (q) {
      const term = `%${q}%`;
      query = query.where((eb) => eb.or([eb('name', 'ilike', term), eb('code', 'ilike', term)]));
    }
    return query.execute();
  }

  findById(id: string) {
    return this.db.selectFrom('clients').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** `receipts.amount` paid against this client's invoices, subtracted from `invoices.total`. */
  async outstandingPaise(clientId: string): Promise<number> {
    const row = await this.db
      .selectFrom('invoices')
      .select((eb) => [
        eb.fn.coalesce(eb.fn.sum<number>('invoices.total'), sql<number>`0`).as('total'),
        eb.fn.coalesce(eb.fn.sum<number>('invoices.received'), sql<number>`0`).as('received'),
      ])
      .where('client_id', '=', clientId)
      .where('status', '!=', 'CANCELLED')
      .executeTakeFirstOrThrow();
    return Math.max(0, Number(row.total) - Number(row.received));
  }

  insert(
    db: DbExecutor,
    code: string,
    row: {
      name: string;
      billing_city: string;
      engagement: string;
      gstin: string | null;
      contact: string | null;
      phone: string | null;
      email: string | null;
      agreement_no: string | null;
      valid_from: string | null;
      valid_to: string | null;
      agreement_attachment_id: string | null;
      credit_days: number;
      service_level: string | null;
    },
  ) {
    const values = { code, ...row };
    return db.insertInto('clients').values(values).returningAll().executeTakeFirstOrThrow();
  }

  update(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('clients').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }

  // ---- Rate revision -------------------------------------------------
  // A revision never UPDATEs a rate. It closes the lane in force and inserts a
  // successor, so an indent priced last month still cross-checks against the
  // number that was agreed last month (`rate-revision.ts`).

  findLane(laneId: string) {
    return this.db.selectFrom('rate_card_lanes').selectAll().where('id', '=', laneId).executeTakeFirst();
  }

  /**
   * Locked for the duration of the approval handler. Two revisions approved
   * against the same lane in the same second would otherwise both read the
   * open lane, both close it, and both insert a successor — leaving two rates
   * in force for the same route on the same day, which is precisely the
   * ambiguity the day-before `valid_to` exists to prevent.
   */
  findLaneForUpdate(db: DbExecutor, laneId: string) {
    return db
      .selectFrom('rate_card_lanes')
      .selectAll()
      .where('id', '=', laneId)
      .forUpdate()
      .executeTakeFirst();
  }

  closeLane(db: DbExecutor, laneId: string, validTo: string) {
    return db
      .updateTable('rate_card_lanes')
      .set({ valid_to: validTo, updated_at: new Date().toISOString() })
      .where('id', '=', laneId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  insertLane(
    db: DbExecutor,
    row: {
      client_id: string;
      rfq_lane_id: string;
      origin: string;
      destination: string;
      truck_type: string;
      rate: number;
      transit_days: number | null;
      reporting_rule: string | null;
      valid_from: string;
      valid_to: string | null;
      supply_source: RateCardLanesTable['supply_source'];
      supply_remarks: string | null;
    },
  ) {
    return db.insertInto('rate_card_lanes').values(row).returningAll().executeTakeFirstOrThrow();
  }

  insertRevision(
    db: DbExecutor,
    row: {
      client_id: string;
      from_lane_id: string;
      old_rate: number;
      new_rate: number;
      effective_from: string;
      reason: string;
      approval_id: string | null;
      requested_by: string;
    },
  ) {
    return db.insertInto('rate_revisions').values(row).returningAll().executeTakeFirstOrThrow();
  }

  updateRevision(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db
      .updateTable('rate_revisions')
      .set({ ...patch, updated_at: new Date().toISOString() })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /** The pending revision raised for one approval, found on the way back in. */
  findRevisionByApproval(db: DbExecutor, approvalId: string) {
    return db
      .selectFrom('rate_revisions')
      .selectAll()
      .where('approval_id', '=', approvalId)
      .executeTakeFirst();
  }

  /** A revision already queued against this lane — one at a time, deliberately. */
  findOpenRevisionForLane(laneId: string) {
    return this.db
      .selectFrom('rate_revisions')
      .selectAll()
      .where('from_lane_id', '=', laneId)
      .where('status', '=', 'PENDING')
      .executeTakeFirst();
  }

  listRevisions(clientId: string) {
    return this.db
      .selectFrom('rate_revisions')
      .leftJoin('rate_card_lanes as l', 'l.id', 'rate_revisions.from_lane_id')
      .leftJoin('users as u', 'u.id', 'rate_revisions.requested_by')
      .select([
        'rate_revisions.id',
        'rate_revisions.status',
        'rate_revisions.old_rate as oldRate',
        'rate_revisions.new_rate as newRate',
        'rate_revisions.effective_from as effectiveFrom',
        'rate_revisions.reason',
        'rate_revisions.created_at as createdAt',
        'l.origin',
        'l.destination',
        'l.truck_type as truckType',
        'u.name as requestedByName',
      ])
      .where('rate_revisions.client_id', '=', clientId)
      .orderBy('rate_revisions.created_at', 'desc')
      .execute();
  }

  rateCard(clientId: string) {
    return this.db
      .selectFrom('rate_card_lanes')
      .selectAll()
      .where('client_id', '=', clientId)
      .orderBy('origin')
      .execute();
  }
}
