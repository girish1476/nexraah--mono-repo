import 'reflect-metadata';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DB, PORTAL_DB } from '../../db/tokens';
import { PortalDbModule } from '../../db/portal-db.module';
import { PortalFleetRepository } from './portal-fleet.repository';
import { PortalIdempotencyRepository } from './portal-idempotency.repository';
import { PortalIdentityRepository } from './portal-identity.repository';
import { PortalLoadsRepository } from './portal-loads.repository';
import { PortalProfileRepository } from './portal-profile.repository';
import { PortalTripsRepository } from './portal-trips.repository';

/**
 * ADR-02 §3.1 — the transporter side reads and writes only as `vendor_api`.
 *
 * Until 27 Oct 2026 both pools were bound to one `DB` token and the global
 * internal binding won, so every portal query ran as `internal_api`. These pin
 * the fix: the portal repositories ask for `PORTAL_DB`, the portal module is
 * the only thing that provides it, and nothing in `modules/portal` asks for the
 * internal `DB`. (`PortalModule`'s start-up check confirms the binding against
 * a live database; this catches the mistake before anything runs.)
 */

/** The token each constructor parameter was declared with — Nest keeps them under `self:paramtypes`. */
const injected = (cls: object) =>
  ((Reflect.getMetadata('self:paramtypes', cls) ?? []) as { index: number; param: unknown }[]).map((p) => p.param);

describe('the transporter side’s database binding', () => {
  const repositories = [
    PortalFleetRepository,
    PortalIdempotencyRepository,
    PortalIdentityRepository,
    PortalLoadsRepository,
    PortalProfileRepository,
    PortalTripsRepository,
  ];

  it.each(repositories.map((r) => [r.name, r] as const))('%s is given the portal database', (_name, repo) => {
    expect(injected(repo)).toContain(PORTAL_DB);
    expect(injected(repo)).not.toContain(DB);
  });

  it('only the portal module provides it, and it does not provide the internal one', () => {
    const providers = (Reflect.getMetadata('providers', PortalDbModule) ?? []) as { provide: unknown }[];
    const exported = (Reflect.getMetadata('exports', PortalDbModule) ?? []) as unknown[];
    expect(providers.map((p) => p.provide)).toEqual([PORTAL_DB]);
    expect(exported).toEqual([PORTAL_DB]);
  });

  it('no file in modules/portal asks for the internal database', () => {
    const dir = __dirname;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
      .filter((f) => /@Inject\(DB\)/.test(readFileSync(join(dir, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
