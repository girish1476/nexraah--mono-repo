import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

@Injectable()
export class LeadsRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  list() {
    return this.db.selectFrom('leads').selectAll().orderBy('created_at', 'desc').execute();
  }

  findById(id: string) {
    return this.db.selectFrom('leads').selectAll().where('id', '=', id).executeTakeFirst();
  }

  insert(
    db: DbExecutor,
    row: {
      code: string;
      name: string;
      city: string | null;
      source: string | null;
      partyType: string | null;
      trucksClaimed: number | null;
      phone: string | null;
      ownerId: string;
    },
  ) {
    return db
      .insertInto('leads')
      .values({
        code: row.code,
        name: row.name,
        city: row.city,
        source: row.source,
        party_type: row.partyType,
        trucks_claimed: row.trucksClaimed,
        phone: row.phone,
        owner_id: row.ownerId,
        stage: 'NEW',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  update(id: string, patch: Record<string, unknown>) {
    return this.db.updateTable('leads').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
}
