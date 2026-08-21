import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import type { Pool } from 'pg';
import type { Database } from './types';

export function createKysely(pool: Pool): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}

export type InternalDb = Kysely<Database>;
export type PortalDb = Kysely<Database>;

/**
 * A repository or service method that must run inside the caller's
 * transaction (`AuditService`, `NumberingService` — both non-negotiable per
 * NFR-03 and NFR-08) takes this instead of `InternalDb` so it can be handed
 * either a bare connection or an open `trx` from `db.transaction().execute()`.
 */
export type DbExecutor = Kysely<Database> | Transaction<Database>;
