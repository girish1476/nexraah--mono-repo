# Part 14 · Supabase and database setup — wave `C1`, prerequisite for all waves

| | |
|---|---|
| **Wave** | `C1` — before any table exists |
| **Depends on** | `ADR-02`, part 02 (the schema), `vendor-specs/01-P1` §1.2 (the grants) |
| **Rules owned** | `NFR-04`, `NFR-05` operational half, `NFR-09` enforcement |
| **Consumed by** | Every part. Part 02 says *what* the schema is; this says how it gets into Postgres and how a process connects to it |

Part 02 lists columns. It does not say what tool writes them, what a status column's Postgres type is, how a process authenticates, or which Supabase features are in play. Nobody could bring up a working database from part 02 alone. This part closes that.

---

## 1 · One Supabase project, both applications

One project holds Postgres, Auth and Storage for both sides. `internal-portal`, `vendor-portal`, `internal-api` and `vendor-api` all resolve to it. There is no second project and no second database.

Auth is shared too: a transporter's bearer token and an operations user's bearer token are issued by the **same** Supabase project. They are told apart by role presence, not by issuer — an internal principal reaching `/portal/*` gets `403 WRONG_AUDIENCE`, and a transporter principal reaching an internal route gets `403` before any permission check (`00-conventions.md` §4, `vendor-specs/01-P1` §3).

Sharing one project is what makes the column grants meaningful. Two databases would need a synchronisation path, and a synchronisation path is a second place a `client_id` can end up.

| Environment | Project | Notes |
|---|---|---|
| `local` | Supabase CLI, Docker | `supabase start`. The only environment where seed data is fabricated |
| `staging` | its own project | Restore-drill target (§8) |
| `production` | its own project | PITR enabled |

Migrations run in that order and never skip staging.

---

## 2 · Migrations — Supabase CLI, raw SQL

```
supabase/
  migrations/
    20260814090000_c1_schema_and_roles.sql    -- part 02 §1-§6 + both roles + grants
    20260814090100_c1_seed_reference.sql      -- §7
    ...
  seed.sql                                     -- local only, never applied to staging or production
```

**Raw SQL, applied by `supabase db push`. No ORM migration engine.** The load-bearing DDL in this system is `CREATE ROLE`, column-level `GRANT` and `REVOKE` (`vendor-specs/01-P1` §1.2). Prisma, Drizzle and TypeORM model none of those — they would have to live in escape-hatch raw-SQL blocks the migration tool cannot diff, which means the tool's idea of the schema and the schema's actual security posture drift on the first `db pull`. A migration engine that silently drops a `REVOKE` on a regenerate is a `BR-55` incident.

| Rule | |
|---|---|
| Naming | `YYYYMMDDHHMMSS_wave_description.sql`, timestamp UTC |
| Forward only | No down migrations. A mistake is corrected by a new migration. Rolling back a schema under live data is a restore (§8), not a `DOWN` block |
| One concern each | Schema, then grants, then seed. A migration that both adds a column and grants it is two migrations |
| Grants ship with tables | **In the same migration as the tables they cover.** A grant added later is a grant that gets forgotten — part 02 §7 |
| Review | Any migration touching `GRANT`, `REVOKE` or `CREATE ROLE` needs a second reviewer, same rule as the portal path |

`C1` is "written in one migration" throughout the specs. Read that as one wave, in the file order above, not one file.

---

## 3 · DDL conventions

Part 02 gives column names. These fill in the rest, so two developers writing two tables produce the same shapes.

| Concern | Rule |
|---|---|
| Primary keys | `id uuid primary key default gen_random_uuid()`. `pgcrypto` is enabled by Supabase |
| Business codes | `code text not null unique` — `VND-`, `IND-`, `LR-`. Allocated from `number_series` under `SELECT … FOR UPDATE` (part 01 §5), never from a sequence. A gap in a legal document series is a question from an auditor |
| Money | `bigint not null`, paise. Database columns keep part 02's names (`sell_rate`, `buy_rate`, `amount`); the `…Paise` suffix is the API mapping, not the column (`NFR-09`). **No `numeric`, `float`, `real` or `money` on any money column** — asserted by `supabase/tests/grants.sql` §6 against `information_schema.columns`, not by review |
| Physical quantities | Integer, in the smallest unit. `weight_kg`, `capacity_kg` — **not** `weight_tn`. Whole tonnes would lose the half-tonne loads this business runs, and `NFR-09` bars the `numeric` that would carry them, so the unit changes rather than the type. The API still exposes `weightTn` |
| Coordinates | `numeric(9,6)` on `branches.lat/lng` and `telematics_pings.lat/lng`. **The only four approximate columns in the schema**, listed as exceptions in the `NFR-09` test. A coordinate is not money; integer microdegrees buys nothing but arithmetic bugs |
| Status columns | `text` + `CHECK (status IN (…))`, **not** a native `enum`. Adding a value to a Postgres enum is fine; removing or reordering one requires rewriting the type and every dependent column. Thirty-odd status columns across thirteen entities will change during the first year |
| Timestamps | `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()` on **every** table, `updated_at` maintained by one shared trigger. Part 02 omits these from its listings; they are not optional |
| Dates | `date` for date-only fields (`pickup_date`, `received_on`, `value_date`), `timestamptz` for everything else. Never `timestamp` |
| Foreign keys | Declared, always. `ON DELETE RESTRICT` by default. `ON DELETE CASCADE` **only** from a child that has no meaning alone (`role_permissions`, `rfq_lanes`). Never on anything carrying money or a document |
| Nullability | `not null` unless the specification names a state where the value is genuinely unknown. Default to `not null` and argue for the exception |
| Text | `text`, never `varchar(n)`. Length limits are validation, not storage |
| Arrays | `text[]` is used once, `vendors.operating_states`. Do not add a second without a reason |
| Naming | `snake_case` tables and columns, plural tables. The API layer maps to `camelCase`; the database never sees a camelCase identifier |

`audit_events` keeps the DDL already written at part 01 §8, including the `UPDATE`/`DELETE` triggers that raise.

---

## 4 · Connecting — `pg`, two pools, and never `service_role`

```ts
// apps/internal-api/src/db/pools.ts
export const internalPool = new Pool({ connectionString: env.DATABASE_URL_INTERNAL })
export const portalPool   = new Pool({ connectionString: env.DATABASE_URL_PORTAL })
```

Two Postgres logins, two connection strings, two pools (`ADR-02` §3). `PortalModule` binds `portalPool` under the `DB` token so no portal repository can name `internalPool`.

**Query builder: [Kysely](https://kysely.dev) over `pg`.** Typed, no runtime code generation, no migration engine of its own, and it takes a `Pool` as an argument — which is the whole requirement, since the design's security control *is* which pool a query runs on. Prisma manages its own connections and would have to be instantiated twice with two engines; that fights §2 as well.

> ### `service_role` is used by nothing in this system
>
> Supabase's `service_role` key bypasses every `GRANT` and every policy by design. A developer reaching for `@supabase/supabase-js` with `service_role` — the default shape in most Supabase documentation — voids redaction layer one completely, and every other isolation assertion still passes. The column grants are simply not consulted.
>
> **Postgres access is via `pg`/Kysely as `internal_api` or `vendor_api`.** The Supabase JS client is used for exactly two things: verifying an Auth JWT, and signing a Storage URL. Neither needs `service_role`.
>
> `SUPABASE_SERVICE_ROLE_KEY` must not appear in any `.env` of any application. Assert its absence in CI. This is the single most likely way this design gets quietly dismantled.

### 4.1 Auth

`SupabaseJwtGuard` verifies the bearer token against the project's JWKS endpoint, cached, with the issuer and expiry checked. It does not call the Auth admin API per request.

The claim that matters is `sub`, joined to `users.auth_user_id` for internal principals and to `vendor_users.user_id` for transporters. Roles and permissions come from **our** tables, never from a JWT claim — a permission in a token is a permission that survives its own revocation until the token expires.

`vendor_users` needs `UNIQUE (user_id)`, which part 02 §2 does not currently declare. Without it, `vendor-specs/01-P1` §2.2's "fails closed with 500 if more than one row" is a runtime check guarding a state the schema permits.

---

## 5 · Pooling — Supavisor **session** mode

**Session mode, or a direct connection. Not transaction mode.**

Transaction-mode pooling multiplexes many clients over few server connections and does not preserve per-connection identity or prepared statements. The dual-pool control depends on the connection's Postgres role being the one we bound — under transaction mode that guarantee does not hold, and layer one becomes decorative.

| Consumer | Pool | Max | Notes |
|---|---|---|---|
| `internal-api` internal | `internal_api` | 10 | `/api/v1/*` |
| `internal-api` portal | `vendor_api` | 5 | `/api/v1/portal/*`. 200 transporter accounts, mostly idle |
| Background jobs | `internal_api` | 3 | Eleven scheduled jobs, single worker (part 13 §3) |

Eighteen connections against `NFR-05` volumes — 150-200 trips/month, ≥20 concurrent internal users — with headroom inside a Supabase small instance. Revisit only against a measurement, not a hunch.

`vendor-api` holds no pool. It has no database credentials at all (`ADR-02` §5).

### 5.1 Indexes

Part 02 §8 names three. These are needed and missing:

```
vendor_users     (user_id) unique      -- §4.1; every portal request resolves through it
quotes           (indent_id)           -- the award screen's join
quotes           (vendor_id, status)   -- GET /portal/quotes
trips            (vendor_id, stage)    -- GET /portal/trips
attachments      (entity_type, entity_id)
audit_events     (entity_type, entity_id, at)
telematics_pings (vehicle_no, at)      -- the only table that grows continuously
```

`telematics_pings` is the one worth watching. Everything else in this schema grows at roughly 2,400 trips and 12,000 documents a year; ping ingestion is continuous and will be the first table that needs a retention policy rather than an index.

---

### 5.2 `anon` and `authenticated` must be revoked

Supabase grants both roles on tables in `public` by default and expects RLS to be the control. §6 records that we do not use RLS.

**Grants without RLS means PostgREST serves the whole schema** — `indents.sell_rate`, `clients`, `payments` — to anyone holding the anon key, which ships in the browser bundle of both portals. Every column grant in §4 is bypassed, on a port nobody is watching, and no application test would notice.

The roles migration revokes table, sequence, function and schema-usage privileges from both roles and clears the default privileges that would re-grant them on the next table. `supabase/tests/grants.sql` §5 asserts it stays closed.

This is the highest-consequence line in the migration set. If Studio or a Supabase feature misbehaves after it, diagnose the feature — do not reverse the revoke.

---

## 6 · Row Level Security — deliberately **not** used

RLS is the default expectation on Supabase, and this system does not use it. Recording why, so nobody adds it halfway.

Supabase's RLS model resolves `auth.uid()` from a JWT presented by a client connecting as `authenticated`. **No process here connects that way.** `internal-api` connects as a service login, `internal_api` or `vendor_api`, and resolves identity in application code from a verified token. `auth.uid()` would be null in every policy we could write.

Making RLS work would mean `SET LOCAL request.jwt.claims` per request — which requires session-mode pooling (§5, already true), a reliable reset between checkouts, and a policy per table duplicating the `WHERE vendor_id = ctx.vendorId` scoping that already exists in one place. That is a second implementation of the same rule, and `ADR-02` exists to remove one of those.

**Isolation is the four layers of `vendor-specs/02-redaction-contract.md` §3**: column grants, service-key routing, repository scoping, `@Expose()` DTOs. Adopting RLS would be a fifth, not a replacement for any of them.

Revisit only if a client is ever given a direct Supabase connection — for example a mobile app talking to PostgREST. Nothing in the FSD asks for that, and `ADR-02` makes it unreachable.

---

## 7 · Storage

One bucket, **private**, no public access.

```
nexraah/
  pod/{trip_id}/{attachment_id}.{ext}
  bills/{trip_id}/{attachment_id}.{ext}
  kyc/{vendor_id}/{kind}/{attachment_id}.{ext}
  documents/{vendor_id}/{kind}/{attachment_id}.{ext}
```

| Rule | |
|---|---|
| Access | Every read is a **signed URL, 15 minutes**, minted by `internal-api` after it has checked the caller may see the row. The bucket is never readable by an anon or authenticated key |
| Storage policies | Deny-all. Authorisation is the API's job — the bucket has no way to know that a transporter may see their own POD but not another's |
| Writes | Only `internal-api`. `vendor-portal` never uploads directly to Storage; it posts multipart to `/portal/*` (`docs/api/11-portal.md` §4) so the server computes `sha256`, sets `retain_until` and records the actor in one transaction |
| Limits | 10MB, sniffed MIME allow-list `image/jpeg`, `image/png`, `application/pdf`. Server-side. The client-side check in `FE.md` §224 is courtesy |
| Identity images | `NFR-04` — encrypted at rest, `COMPLIANCE`-only, deleted on relationship closure (`R-04`). The `identity-image-purge` job (part 13 §3) owns the deletion |
| Deletion | `attachment-retention` deletes the object **and** the row. An orphan object is a `NFR-04` finding; an orphan row is a broken screen |
| Path stability | Paths embed ids, never names. A vendor renaming their firm must not move a file |

Storage objects are **not** covered by Postgres PITR. See §8.

---

## 8 · Environments, backup and restore

| | |
|---|---|
| Backup | Daily automated, 30-day PITR on production |
| Storage | **Objects are not in PITR.** A separate scheduled copy of the bucket to cold storage, same 30-day retention. A restored database pointing at deleted PODs is not a restore |
| Drill | Quarterly, restore to a scratch project, verified by running the isolation suite against it — a restore that loses `vendor_api`'s grants looks healthy and is not |
| Runbook | `docs/ops/restore.md`. **Currently missing** — part 13 §2 cites it and it does not exist. Write it before go-live |

---

## 9 · Environment variables

No specification currently names one. This is the contract; `.env.example` in each application must match it exactly.

### `apps/internal-api/.env`

```
PORT=4002
DATABASE_URL_INTERNAL=postgresql://internal_api:…@…:5432/postgres   # session mode
DATABASE_URL_PORTAL=postgresql://vendor_api:…@…:5432/postgres       # session mode
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=…                 # JWT verification and Storage signing only
SUPABASE_JWT_ISSUER=https://<ref>.supabase.co/auth/v1
PORTAL_SERVICE_KEY=…                # shared with vendor-api, 32 bytes random
STORAGE_BUCKET=nexraah
# SUPABASE_SERVICE_ROLE_KEY — deliberately absent. See §4
```

### `apps/vendor-api/.env`

```
PORT=4001
INTERNAL_API_URL=http://localhost:4002/api/v1
PORTAL_SERVICE_KEY=…                # must match internal-api
CORS_ORIGIN=http://localhost:3001
# No DATABASE_URL. No SUPABASE_* key. A database driver here is a CI failure
```

### Frontends

```
# apps/internal-portal/.env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:4002/api/v1
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
NEXT_PUBLIC_USE_MOCKS=1

# apps/vendor-portal/.env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:4001/api/v1     # the edge, never 4002
NEXT_PUBLIC_SUPABASE_URL=…
NEXT_PUBLIC_SUPABASE_ANON_KEY=…
NEXT_PUBLIC_USE_MOCKS=1
```

`vendor-portal` currently reads `NEXT_PUBLIC_MOCK` and falls back to a base URL missing the `/v1` segment. Both are bugs against this table.

**Anything prefixed `NEXT_PUBLIC_` is in the browser bundle.** The anon key belongs there; nothing else in this section does.

---

## 10 · Seeding

Part 01 already specifies seed *content* — twelve permission grants, nine number series, the eight-document set. This is how it is applied.

| Environment | What |
|---|---|
| All | Roles, permissions, `role_permissions`, `number_series`, `config` defaults, document kinds. **Idempotent** — `INSERT … ON CONFLICT DO NOTHING`, keyed on `code`. It runs on every deploy |
| Local only | `supabase/seed.sql` — two branches, three vendors (one `ACTIVE`, one `PENDING_VERIFICATION`, one `SUSPENDED`), five indents, three trips at different stages, one transporter login. Enough to open every screen |

Reference seed is a migration, not a script, so it is versioned with the schema that needs it. Fixture seed is never applied to staging or production.

---

## 11 · Done when

- [ ] `supabase start` then `supabase db push` produces a working local database from an empty checkout
- [ ] `psql` as `vendor_api` — `SELECT client_id FROM indents` **raises**
- [ ] `psql` as `vendor_api` — `INSERT INTO audit_events` succeeds, `SELECT` raises
- [ ] No column anywhere is `numeric`, `float`, `real` or `money` — asserted against `information_schema`
- [ ] Every table has `created_at` and `updated_at`, with the trigger maintaining the latter
- [ ] `vendor_users (user_id)` is unique
- [ ] `SUPABASE_SERVICE_ROLE_KEY` appears in no `.env` and no source file — asserted in CI
- [ ] `apps/vendor-api/package.json` contains no database driver — asserted in CI
- [ ] Both pools connect in **session** mode and a portal request is provably running as `vendor_api`
- [ ] `.env.example` exists in all four applications and matches §9
- [ ] Reference seed is idempotent across two consecutive runs
- [ ] The bucket denies anon and authenticated reads; every access path is a 15-minute signed URL
- [ ] `docs/ops/restore.md` exists and a drill has been run against a scratch project
