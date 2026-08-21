import { Module } from '@nestjs/common';
import { Kysely, PostgresDialect } from 'kysely';
import { portalPool } from './pools';
import { DB } from './tokens';
import type { Database } from './types';

const portalDb = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: portalPool }),
});

/**
 * ADR-02 §3.1. Bound to the SAME `DB` token as `InternalDbModule`, but to
 * `portalPool` (role `vendor_api`) instead. Imported ONLY by `PortalModule`
 * — never made `@Global()`, and never imported by any other feature module.
 * A portal repository that ends up with `internalPool` is a lint-catchable
 * import mistake, not a silent one: this module is the one and only place
 * that binding can come from.
 */
@Module({
  providers: [{ provide: DB, useValue: portalDb }],
  exports: [DB],
})
export class PortalDbModule {}
