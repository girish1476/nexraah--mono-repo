# ADR-02 — `internal-api` owns every operation; `vendor-api` becomes a proxy

**Status:** accepted · supersedes the backend half of `ADR-01`
**Date:** 2026-08-13
**Affects:** `SPEC-1` §1, `SPEC-2` §1, `vendor-specs/01-P1` §1 and §3, `vendor-specs/02-redaction-contract` §3–§4, `internal-spec/01-C1` §1, `internal-spec/02-data-model` §7, `docs/api/00-INDEX`, `docs/api/03-clients-indents` §211, `README` §ADR-01

---

## 1 · Decision

All business logic and all database access live in `internal-api`. It serves the transporter surface itself, under `/api/v1/portal/*`.

`vendor-api` survives as a **pure HTTP proxy**. It holds no database credentials, no entity, no repository, no business rule and no DTO. It terminates TLS for the external audience, applies external rate limits and CORS, stamps a request id, and forwards.

```
vendor-portal        Next.js 14 · port 3001 · its own deployable
        │  HTTPS · Bearer JWT (the transporter's Supabase token)
        ▼
vendor-api           NestJS · port 4001 · proxy only · NO DB credentials
        │  HTTPS · X-Portal-Service key + the transporter's Bearer token, unmodified
        ▼
internal-api         NestJS · port 4002
        │            /api/v1/*        → internalPool   (internal_api role)
        │            /api/v1/portal/* → portalPool     (vendor_api role)
        ▼
Supabase             Postgres · Auth · Storage
```

`ADR-01`'s frontend split is untouched and remains correct: `vendor-portal` stays a separate Next.js application with no shared layout, navigation or component. Nothing in this ADR reopens that.

## 2 · Why

`ADR-01` gave the vendor side its own backend with its own Postgres role. That is a strong boundary, and it is also two implementations of every rule that touches both sides. `BR-05` band enforcement, `BR-23` KYC, `BR-51` POD attachment and `BR-53` vendor bill were each specified once in `internal-spec` and again in `vendor-specs`, in a different process, against a different DTO. Two implementations of one rule drift, and the drift is silent because no test spans both.

Under this ADR each rule is written once, in the service that owns the table.

**What this costs:** `ADR-01`'s process layer no longer means "a vendor request never enters a process with internal controllers loaded", because now it does. §3 replaces that guarantee rather than dropping it.

**What made it affordable:** nothing is built. Both NestJS apps are scaffolds with a single `GET /health` and no database dependency in either `package.json`. The pivot costs specification, not code.

**What it does not violate:** FSD v2.2 requires redaction *at the source* (`NFR-02`, `BR-55`, `D-38`, `:560`, `:743`, `:800`, `:871`) and names no application topology. `VERIFICATION-FSD-vs-SPEC-2.md` §79 records `ADR-01` as a spec-level decision, not an FSD requirement. This ADR re-decides it; the FSD rule it exists to serve is unchanged and still binding.

## 3 · The four redaction layers, preserved

`vendor-specs/02-redaction-contract.md` §3 is load-bearing and stays four layers deep. Two of them are re-founded.

| Layer | Before (`ADR-01`) | Now |
|---|---|---|
| **Database** | `vendor-api` process holds the `vendor_api` login | `internal-api` opens **two pools**. `portalPool` authenticates as `vendor_api`; `internalPool` as `internal_api`. Every `/api/v1/portal/*` handler uses `portalPool` and nothing else |
| **Process** | Internal controllers not loaded in the vendor process | `/portal/*` is reachable **only** with a valid `X-Portal-Service` key; every other internal route **rejects** that key. `vendor-api` proxies `/portal/*` and nothing else, so no internal path is internet-reachable through the vendor edge |
| **Repository** | `WHERE vendor_id = ctx.vendorId`, no override | unchanged |
| **Serialisation** | `@Expose()` allow-list, never `@Exclude()` | unchanged, now living in `internal-api`'s portal module |

The database layer is the one that mattered in `ADR-01` §1.2 — *"a DTO that forgets an `@Exclude()` is one code review away from leaking; a missing `GRANT` is not."* The dual pool keeps that sentence true. A portal handler that selects `indents.client_id` raises at the database, exactly as before, because the credential the query runs under is still `vendor_api`.

### 3.1 Pool binding is the control — enforce it structurally

`portalPool` must not be reachable from a non-portal handler and `internalPool` must not be reachable from a portal one. Bind it at the module, not at the call site:

```ts
// PortalModule provides the vendor_api-bound connection under the token every
// portal repository injects. No portal repository can name internalPool.
@Module({
  providers: [{ provide: DB, useExisting: PORTAL_POOL }],
})
export class PortalModule {}
```

A portal repository that wants `internalPool` has to edit this module, which is the deliberate act the whole design is built on.

### 3.2 This forces Supavisor **session** mode

Transaction-mode pooling multiplexes connections across clients and does not preserve per-connection role identity or prepared statements. The dual-pool control depends on the connection's Postgres role being what we bound it to. Use session mode, or a direct Postgres connection, for both pools. Record the pool sizes: `internal-api` runs two pools plus eleven background jobs (`internal-spec/13-cross-cutting.md` §3) against one project.

### 3.3 `service_role` is forbidden

Supabase's `service_role` key bypasses every grant and every policy. A developer reaching for `@supabase/supabase-js` with `service_role` — the obvious default, and the shape most Supabase tutorials teach — silently voids layer one entirely and no test currently catches it.

**`service_role` is used by nothing in this system.** Postgres access is via `pg` with the `internal_api` or `vendor_api` login. The Supabase client is used only for Auth token verification and Storage signing. See `internal-spec/14-supabase-setup.md` §4.

## 4 · The trust boundary

Two credentials travel together on every portal request, and they answer different questions.

| Credential | Set by | Answers | Verified by |
|---|---|---|---|
| `Authorization: Bearer <jwt>` | the transporter's browser | *who is this* | `internal-api`, against Supabase Auth |
| `X-Portal-Service: <key>` | `vendor-api` | *did this arrive through the vendor edge* | `internal-api`, constant-time compare against `PORTAL_SERVICE_KEY` |

**`vendor-api` never asserts identity.** It forwards the transporter's token unmodified and sets no `X-Vendor-Id` header. `internal-api` resolves `vendorId` from `vendor_users` against the JWT subject, exactly as `PortalGuard` did before. A proxy that could name the vendor would be a proxy that could impersonate one; the service key proves provenance and nothing else.

The lock is two-way:

- A request to `/api/v1/portal/*` **without** a valid service key → `403 SERVICE_KEY_REQUIRED`. `/portal/*` is not directly internet-reachable.
- A request to any other `/api/v1/*` route **with** a service key → `403 WRONG_AUDIENCE`. The vendor edge cannot reach an internal route even if someone adds a proxy rule.
- A principal holding an internal role calling `/portal/*` → `403 WRONG_AUDIENCE`, unchanged from `vendor-specs/01-P1` §3.
- A transporter principal calling a non-portal route → `403`, unchanged from `docs/api/00-conventions.md` §78.

`PORTAL_SERVICE_KEY` is a shared secret in the environment of both processes, rotated by restarting `vendor-api` then `internal-api`. It is not a JWT and carries no claims — it is one bit of information and should stay that way.

## 5 · What `vendor-api` may and may not contain

| May | May not |
|---|---|
| Reverse proxy for `/api/v1/portal/*` | Any `pg`, `@supabase/supabase-js`, Prisma, Drizzle or TypeORM dependency |
| Rate limits (`vendor-specs/01-P1` §4) | Any entity, repository, DTO or business rule |
| CORS allow-list for `vendor-portal` only | Any route outside `/api/v1/portal/*` |
| Request id generation and access logging | Any read or write of a response **body** |
| TLS termination, timeouts, retries | Any knowledge of `vendorId` |

**It does not translate errors.** `internal-api`'s portal module emits vendor-vocabulary errors directly (`vendor-specs/11-cross-cutting.md` §39-46); the proxy passes bodies through byte-for-byte. Translating in the proxy would put a `BR-55` leak decision in the one process that cannot see the database — an internal `ADVANCE_BLOCKED` with a `details.unmet` array would have to be scrubbed by a process with no idea what the fields mean.

A `package.json` with a database driver in it is the tripwire. Assert it in CI.

## 6 · Rules that move to `internal-api`

Each was specified in `vendor-specs` as a `vendor-api` service. Each now has exactly one implementation, in the portal module, sharing the service the internal side already calls.

| Rule | Was | Now |
|---|---|---|
| `BR-05` quote band | `vendor-api` quote service | `internal-api` portal quote handler, same band service the RFQ award path uses |
| `BR-23` KYC completeness | `vendor-api` profile service | `internal-api` portal profile handler, same compliance service |
| `BR-51` POD attachment | `vendor-api` POD service | `internal-api` portal POD handler, feeding the same `pod_receipts` lifecycle that `docs/api/05-pod.md` picks up at `RECEIVED` |
| `BR-53` vendor bill | `vendor-api` bill service | `internal-api` portal bill handler, same `vendor_bills` service |
| `BR-54`, `BR-55` redaction | `vendor-api` DTOs | `internal-api` portal DTOs, `portalPool`, unchanged in substance |

`docs/api/05-pod.md` §14 assigns the `ATTACHED` state to "Transporter, in their portal · Spec 1" and starts the internal lifecycle at `RECEIVED`. That split stays — but both halves are now `internal-api` code, so the handoff is a service call rather than a shared table two processes write.

## 7 · Cross-service concerns this introduces

None of these existed under `ADR-01` because there was no hop. All are specified in `internal-spec/13-cross-cutting.md` §5 and `docs/api/11-portal.md`.

| Concern | Rule |
|---|---|
| Request id | `vendor-api` generates `X-Request-Id` if absent and forwards it. `internal-api` logs it on every line and returns it on every response, success or error |
| Timeout | `vendor-api` → `internal-api`: 30s for multipart, 10s otherwise. On timeout return `504 UPSTREAM_TIMEOUT` |
| Retry | **Idempotent methods only** — `GET`, `HEAD`. Two attempts, 250ms backoff. Never retry a `POST`; that is what the idempotency key is for |
| Idempotency | Required on all six portal writes. See `docs/api/11-portal.md` §3 |
| Rate limits | External limits stay at the `vendor-api` edge where the client IP is real. `internal-api` gains its own limits (`internal-spec/13-cross-cutting.md`) because it is now reachable from the vendor tier |
| Audit actor | `audit_events.actor_role` records `PORTAL` with the resolved `vendor_id` for portal-originated writes. `NFR-03` was previously blind to vendor actions because they happened in a process with no `audit_events` grant |
| File upload | Multipart is proxied through, streamed, not buffered. `docs/api/11-portal.md` §4 resolves this against `docs/api/00-conventions.md` §188 |

## 8 · Consequences

**Better**

- One implementation per business rule. `BR-05`, `BR-23`, `BR-51`, `BR-53` cannot drift between two processes.
- Vendor actions land in `audit_events`. They previously could not — `vendor_api` has no grant on that table.
- One schema owner. Adding a column no longer requires deciding which of two backends learns about it.

**Worse**

- One more network hop on every transporter request. At `NFR-05` scale (200 transporter accounts, 150-200 trips/month) this is not a latency concern; it is an availability one — `internal-api` down now means the portal is down, where before it might have limped.
- `internal-api` is internet-reachable through the proxy. It needs the rate limits, CORS discipline and external-audience logging that `SPEC-1` §1.2 previously said were "tuned for an external audience without touching the console".
- A leak now requires the dual-pool binding to hold. §3.1 makes that structural, but it is a property of `internal-api`'s module wiring rather than of the operating system's process boundary, and it is weaker for that.

**Watch for**

- Any portal repository that injects `internalPool`. This is the single failure mode that voids layer one. It should be a lint rule, not a review habit.
- Any dependency landing in `apps/vendor-api/package.json` that can open a socket to Postgres.

## 9 · Rejected alternatives

**Delete `vendor-api`; let `vendor-portal` call `internal-api` directly.** Fewer moving parts, no service-key scheme. Rejected because it deletes the process layer outright rather than re-founding it, puts `internal-api` directly on the internet with no external edge to carry rate limits and CORS, and leaves nothing between a transporter's token and `/api/v1/pnl` except a guard.

**Keep `ADR-01` unchanged.** Rejected on the duplicate-rule cost in §2. The redaction argument for it is strong; the two-implementations-of-`BR-05` argument against it is stronger, and §3 shows the redaction argument survives the change.

**One backend, app-layer redaction only** (drop the dual pool, keep repository scoping and `@Expose()`). Rejected: it is the "we remembered to redact" posture that `SPEC-1` §1.2 and `internal-spec/02-data-model.md` §7 were both written to escape. The dual pool costs roughly twenty lines and keeps isolation assertion #6 writable.
