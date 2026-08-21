import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';

@Injectable()
export class BranchesRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  findAll() {
    return this.db
      .selectFrom('branches')
      .select(['id', 'code', 'name', 'city', 'catchment_km'])
      .orderBy('name')
      .execute();
  }
}
