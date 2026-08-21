/**
 * One injection token, two bindings. ADR-02 §3.1: `InternalDbModule` binds it
 * to `internalPool` (role `internal_api`); `PortalDbModule` binds the same
 * token to `portalPool` (role `vendor_api`). A repository imports whichever
 * module it needs and injects `DB` — it cannot name a pool directly, so
 * reaching for the wrong one means editing the wrong module import, which is
 * the deliberate, reviewable act the whole design rests on.
 */
export const DB = Symbol('DB');
