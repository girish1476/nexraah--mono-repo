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
    return this.db
      .selectFrom('leads')
      .leftJoin('vendors', 'vendors.id', 'leads.converted_vendor_id')
      .select([
        'leads.id as id',
        'leads.code as code',
        'leads.name as name',
        'leads.city as city',
        'leads.source as source',
        'leads.party_type as party_type',
        'leads.trucks_claimed as trucks_claimed',
        'leads.phone as phone',
        'leads.stage as stage',
        'leads.notes as notes',
        'leads.converted_vendor_id as converted_vendor_id',
        'vendors.code as converted_vendor_code',
        'vendors.legal_name as converted_vendor_name',
      ])
      .orderBy('leads.created_at', 'desc')
      .execute();
  }

  findById(id: string) {
    return this.db.selectFrom('leads').selectAll().where('id', '=', id).executeTakeFirst();
  }

  /** Same joined shape as `list()`, scoped to one row — what `create()`/`update()` return, so a lead already converted before this edit doesn't lose its `convertedVendor*` fields in the response. */
  findByIdJoined(id: string) {
    return this.db
      .selectFrom('leads')
      .leftJoin('vendors', 'vendors.id', 'leads.converted_vendor_id')
      .select([
        'leads.id as id',
        'leads.code as code',
        'leads.name as name',
        'leads.city as city',
        'leads.source as source',
        'leads.party_type as party_type',
        'leads.trucks_claimed as trucks_claimed',
        'leads.phone as phone',
        'leads.stage as stage',
        'leads.notes as notes',
        'leads.converted_vendor_id as converted_vendor_id',
        'vendors.code as converted_vendor_code',
        'vendors.legal_name as converted_vendor_name',
      ])
      .where('leads.id', '=', id)
      .executeTakeFirst();
  }

  findByIdForUpdate(db: DbExecutor, id: string) {
    return db.selectFrom('leads').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
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
      notes: string | null;
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
        notes: row.notes,
        stage: 'NEW',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  update(id: string, patch: Record<string, unknown>) {
    return this.db.updateTable('leads').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }

  updateInTransaction(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db.updateTable('leads').set(patch).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
}
