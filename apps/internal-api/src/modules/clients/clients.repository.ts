import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

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

  rateCard(clientId: string) {
    return this.db
      .selectFrom('rate_card_lanes')
      .selectAll()
      .where('client_id', '=', clientId)
      .orderBy('origin')
      .execute();
  }
}
