import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';

@Injectable()
export class ConfigRepository {
  constructor(@Inject(DB) public readonly db: InternalDb) {}

  /**
   * `20260814090400_c1_role_permissions_and_config.sql` §4: every key of the
   * `GET /config` object is a top-level, dot-free `config.key` row — the
   * filter is what excludes internal lookups like `trip.document_kinds`.
   */
  async findAll(): Promise<Map<string, unknown>> {
    const rows = await this.db
      .selectFrom('config')
      .select(['key', 'value'])
      .where('key', 'not like', '%.%')
      .execute();
    return new Map(rows.map((r) => [r.key, r.value]));
  }

  async upsert(db: DbExecutor, key: string, value: unknown, updatedBy: string): Promise<void> {
    await db
      .insertInto('config')
      .values({ key, value: JSON.stringify(value), updated_by: updatedBy })
      .onConflict((oc) =>
        oc.column('key').doUpdateSet({
          value: JSON.stringify(value),
          updated_by: updatedBy,
          updated_at: sql`now()`,
        }),
      )
      .execute();
  }

  transaction() {
    return this.db.transaction();
  }

  /** GLOBAL series only for now — no `number_series` row is `BRANCH`-scoped yet. */
  async findSeries(db: DbExecutor, key: string) {
    return db
      .selectFrom('number_series')
      .select(['id', 'key', 'prefix', 'next_value', 'width', 'scope', 'branch_id'])
      .where('key', '=', key)
      .where('branch_id', 'is', null)
      .forUpdate()
      .executeTakeFirst();
  }

  async listSeries() {
    return this.db
      .selectFrom('number_series')
      .select(['id', 'key', 'prefix', 'next_value', 'width', 'scope', 'branch_id'])
      .orderBy('key')
      .execute();
  }

  async updateSeries(db: DbExecutor, id: string, nextValue: number, width: number) {
    return db
      .updateTable('number_series')
      .set({ next_value: nextValue, width })
      .where('id', '=', id)
      .execute();
  }
}
