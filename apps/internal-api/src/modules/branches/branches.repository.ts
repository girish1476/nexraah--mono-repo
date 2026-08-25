import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { DbExecutor, InternalDb } from '../../db/kysely';
import type { SupplySourceCode } from './branches.constants';

const COLUMNS = [
  'id',
  'code',
  'name',
  'city',
  'catchment_km',
  'supply_source',
  'supply_remarks',
] as const;

@Injectable()
export class BranchesRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  transaction() {
    return this.db.transaction();
  }

  findAll() {
    return this.db.selectFrom('branches').select(COLUMNS).orderBy('name').execute();
  }

  findById(id: string) {
    return this.db.selectFrom('branches').select(COLUMNS).where('id', '=', id).executeTakeFirst();
  }

  findByCode(code: string) {
    return this.db.selectFrom('branches').select(COLUMNS).where('code', '=', code).executeTakeFirst();
  }

  insert(
    db: DbExecutor,
    row: {
      code: string;
      name: string;
      city: string;
      catchment_km: number;
      supply_source: SupplySourceCode | null;
      supply_remarks: string | null;
    },
  ) {
    return db.insertInto('branches').values(row).returning(COLUMNS).executeTakeFirstOrThrow();
  }

  update(db: DbExecutor, id: string, patch: Record<string, unknown>) {
    return db
      .updateTable('branches')
      .set(patch)
      .where('id', '=', id)
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
  }
}
