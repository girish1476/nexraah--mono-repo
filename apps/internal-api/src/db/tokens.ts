/**
 * Two injection tokens, one per database login. ADR-02 §3.1: `InternalDbModule`
 * binds `DB` to `internalPool` (role `internal_api`); `PortalDbModule` binds
 * `PORTAL_DB` to `portalPool` (role `vendor_api`). A repository cannot name a
 * pool directly — it injects the token for the side it is on.
 *
 * These used to be one token, `DB`, bound twice, on the reasoning that a module
 * would get whichever binding it imported. It does not: `InternalDbModule` is
 * global, and Nest resolved the global binding ahead of the one `PortalModule`
 * imports. Every transporter-portal query ran as `internal_api`, with access to
 * everything — the redaction layer this split exists for was not in force, and
 * `PortalModule`'s own start-up check said so in the log (found 27 Oct 2026,
 * running the API against a real database). A token of its own leaves nothing
 * to resolve. `portal-db-binding.test.ts` holds the transporter side to it.
 */
export const DB = Symbol('DB');

/** The transporter side's database — `portalPool`, role `vendor_api`. Injected only in `modules/portal`. */
export const PORTAL_DB = Symbol('PORTAL_DB');
