# nexraah

pnpm monorepo.

**New here?** [`END_TO_END_GUIDE.md`](END_TO_END_GUIDE.md) tours what every screen is for. [`FLOWS.md`](FLOWS.md) is the flow manual — every handoff, gate and status, and where each record goes next.

## Apps

| App               | Stack   | Port | Description        |
| ----------------- | ------- | ---- | ------------------ |
| `vendor-api`      | NestJS  | 4001 | Vendor edge — **proxy only, no DB** |
| `vendor-portal`   | Next.js | 3001 | Vendor frontend    |
| `internal-api`    | NestJS  | 4002 | **The** backend — all logic, all writes |
| `internal-portal` | Next.js | 3002 | Internal frontend  |

Both serve under the global prefix `/api/v1`. `vendor-api` forwards `/api/v1/portal/*` to `internal-api` and serves no other path.

## The vendor / internal boundary — `ADR-02`

A transporter must never learn who the client is, what we charge them, or what anyone else quoted (FSD `NFR-02`, `BR-55`, `D-38`). The cheapest way to guarantee that is to make a leak require deliberate work rather than forgetfulness.

**`internal-api` owns every operation and every write.** It serves the transporter surface itself under `/api/v1/portal/*`. `vendor-api` is a **proxy with no database credentials** — it terminates TLS for the external audience, rate-limits, and forwards.

```
vendor-portal :3001 ──▶ vendor-api :4001 ──▶ internal-api :4002 ──▶ Supabase Postgres
                        proxy only            all logic, all writes
                        no DB credentials     portalPool  → vendor_api role  → /portal/*
                                              internalPool → internal_api role → everything else
```

| Boundary | What it buys |
| --- | --- |
| Separate Next.js apps | No shared layout, navigation or component that could render a client name. No `if (isTransporter)` branch to get wrong |
| Two connection pools | `/portal/*` handlers run as `vendor_api`, which has column-level `GRANT`s only. A portal query that selects `client_id` or `sell_rate` **raises at the database** |
| Service key both ways | `/portal/*` requires `X-Portal-Service`; every other route rejects it. The vendor edge cannot reach an internal route |
| Separate deployables | The external edge can be rolled back or firewalled on its own |

The two sides share **the database and `packages/*` types. Nothing else.** `packages/*` is types and enums only — no runtime, and no package until a second consumer actually needs a symbol.

`ADR-01` — a full second backend for the vendor side — is superseded. It duplicated `BR-05`, `BR-23`, `BR-51` and `BR-53` across two processes. Read [`docs/adr/ADR-02-internal-owns-operations.md`](docs/adr/ADR-02-internal-owns-operations.md) before touching either backend; spec files still carrying the `ADR-01` shape are marked stale in place.

Specs: `docs/adr/ADR-02-internal-owns-operations.md`, `docs/api/11-portal.md`, `docs/specs/internal-spec/14-supabase-setup.md`.

## Setup

```bash
pnpm install
```

## Run

```bash
# vendor-api + vendor-portal together
pnpm dev:vendor

# internal-api + internal-portal together
pnpm dev:internal

# everything
pnpm dev
```

## Frontend convention

```
src/
  apis.ts                 # root axios instance, envelope, 202/409 handling
  store/atoms.ts          # jotai atoms — session, toast
  lib/                    # cross-page, no API calls
    permissions.ts        #   roles, module matrix, navigation
    ui.tsx                #   Panel · DataTable · Tag · BlockedPanel · Dialog · Field
    format.ts             #   paise → ₹, dates
    documents.ts          #   document kinds, charge types, POD tones
  components/             # cross-page pieces that DO call APIs
    advance-panel.tsx     #   the advance gate, scoped to one record
    balance-panel.tsx     #   the balance gate and its four-line breakdown
    release-dialog.tsx    #   BR-09 capture: mode · transfer · account · UTR · value date
    barcode.tsx           #   Code 39 for LR and invoice prints
  mocks/                  # fixture adapter — delete when internal-api ships
  app/
    layout.tsx  providers.tsx  shell.tsx  globals.css
    <feature>/
      page.tsx
      apis.ts             # feature-scoped API calls
      types.ts            # feature-scoped types
      <sub-route>/page.tsx
```

One `apis.ts` and `types.ts` per **feature folder**, not per route file — sub-routes under `trips/[id]/` import from `../../apis`. Anything used by two features moves to `lib/` (no calls) or `components/` (calls).

## Status

**Both frontends are built** — every route in `docs/specs/internal-spec/01-C1-foundation.md` §1.1 exists, typechecks and builds, plus an `/orders` lifecycle hub added since.

**`internal-api` is now real, not a stub.** Twenty-one modules are implemented and the app builds clean: `auth`, `roles`, `branches`, `config`, `numbering`, `approvals`, `attachments`, `audit`, `vendors` (with leads, market gap, issues), `compliance`, `clients`, `indents`, `trips`, `pod`, `payments`, `invoicing`, `rfq`, `reports`, `pnl`, `telematics`, and `portal`.

**The transporter surface (`/api/v1/portal/*`) is half-built.** Its eight read routes are live — loads (list and detail), quotes, trips (list, detail, lorry receipt), fleet and profile. The writes — quote submit and withdraw, POD upload, vendor bills, fleet mutations, document upload — are the next wave; they need the idempotency ledger and the multipart pipeline, neither of which a read path touches.

`PortalModule` imports `PortalDbModule` and no other database module. That single line is layer one of the redaction contract: it rebinds the `DB` token to `portalPool` (role `vendor_api`) for everything constructed in that module's context. Adding `InternalDbModule` there — or importing any module whose repositories it feeds — voids the layer *silently*: the queries keep working, and the columns that were supposed to raise start returning data. The module asserts its own pool role at boot and logs at error level if it is not `vendor_api`.

**Both portals still default to fixture data**, because the write half of the portal surface is not there yet. The fixture adapter returns the exact shapes the real API returns, so no page changes when you flip the flag:

```bash
# apps/internal-portal/.env.local
NEXT_PUBLIC_USE_MOCKS=1     # default — serve from src/mocks
NEXT_PUBLIC_USE_MOCKS=0     # hit internal-api on :4002
```

The sidebar carries a **role switcher**. It is prototype control, not product: it writes `localStorage.role`, which the mock adapter reads and a real `internal-api` ignores. It goes when Supabase auth lands.

## API contract — `docs/api/`

Every call the console makes, with request and response shapes, error codes and the rule each one carries. **This is the build target for `internal-api`.** Start at [`docs/api/00-INDEX.md`](docs/api/00-INDEX.md), which also carries the screen → endpoint map.

| | |
| --- | --- |
| Conventions — envelope, errors, money, approvals, idempotency | [`00-conventions.md`](docs/api/00-conventions.md) |
| C1 foundation · C2 vendors · C3 indents · C4 trips | `01`–`04` |
| C5 POD · C6 payments · C7 invoicing · C8 RFQ | `05`–`08` |
| C9 reporting · C10 telematics · C11 import | `09`–`10` |
| **Transporter surface** — all 18 `/portal/*` routes | [`11-portal.md`](docs/api/11-portal.md) |
| **Supabase and DB setup** — migrations, pools, env, RLS decision | [`internal-spec/14-supabase-setup.md`](docs/specs/internal-spec/14-supabase-setup.md) |
