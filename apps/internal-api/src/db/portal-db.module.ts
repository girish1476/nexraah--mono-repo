import { Module } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { portalPool } from './pools';
import { PORTAL_DB } from './tokens';
import type { Database } from './types';

const portalDb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: portalPool }),
});

/**
 * ADR-02 §3.1. The transporter side's database: `portalPool` (role
 * `vendor_api`), under a token of its own, `PORTAL_DB`. Imported ONLY by
 * `PortalModule` — never made `@Global()`, and never imported by any other
 * feature module.
 *
 * It used to bind the same `DB` token as the global `InternalDbModule`, which
 * Nest resolved to the internal pool — see `tokens.ts`.
 */
@Module({
  providers: [{ provide: PORTAL_DB, useValue: portalDb }],
  exports: [PORTAL_DB],
})
export class PortalDbModule {}
