import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { sql } from 'kysely';
import type { DbExecutor } from '../../db/kysely';

/**
 * BR-14 / NFR-08 — gap-free, duplicate-free under concurrency. Issuance
 * happens inside the transaction that creates the record, via
 * `SELECT … FOR UPDATE` on the `number_series` row (part 01 §4.1, part 14
 * §2). A number is consumed only if the enclosing transaction commits: if the
 * caller's transaction rolls back after `issue()`, the row-level lock and the
 * `UPDATE` roll back with it, so nothing was ever spent.
 *
 * `key` matches `docs/api/01-foundation.md`'s wire keys directly (`TRIP`,
 * `INDENT`, `VENDOR`, …) — `20260814090400_c1_role_permissions_and_config.sql`
 * §5 seeds `number_series.key` in that same casing. `(key, branch_id)` is the
 * real unique pair (nulls-not-distinct): every seeded row today is `GLOBAL`
 * (`branch_id null`) — `POD_RECEIPT` is the one series part 01 §4.1 makes
 * per-branch, and no row for it exists yet because no branch-creation flow
 * has been built (part 06, POD, owns provisioning it).
 */
@Injectable()
export class NumberingService {
  async issue(db: DbExecutor, key: string, branchId: string | null = null): Promise<string> {
    let query = db
      .selectFrom('number_series')
      .select(['id', 'prefix', 'next_value', 'width'])
      .where('key', '=', key)
      .forUpdate();
    query = branchId === null ? query.where('branch_id', 'is', null) : query.where('branch_id', '=', branchId);
    const row = await query.executeTakeFirst();

    if (!row) {
      throw new InternalServerErrorException(
        `Unknown number series: ${key}${branchId ? ` (branch ${branchId})` : ''}`,
      );
    }

    await db
      .updateTable('number_series')
      .set({ next_value: sql`next_value + 1` })
      .where('id', '=', row.id)
      .execute();

    return `${row.prefix}${String(row.next_value).padStart(row.width, '0')}`;
  }
}
