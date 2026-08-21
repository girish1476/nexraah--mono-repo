import { Global, Module } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { internalPool } from './pools';
import { DB } from './tokens';
import type { Database } from './types';

const internalDb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: internalPool }),
});

/**
 * Every `/api/v1/*` module (everything except the portal surface) imports
 * this. Global so the common case — an internal repository wanting `DB` —
 * needs no per-module wiring; `PortalModule` deliberately does NOT import it
 * (see `portal-db.module.ts`).
 */
@Global()
@Module({
  providers: [{ provide: DB, useValue: internalDb }],
  exports: [DB],
})
export class InternalDbModule {}
