# nexraah

pnpm monorepo.

## Apps

| App               | Stack   | Port | Description        |
| ----------------- | ------- | ---- | ------------------ |
| `vendor-api`      | NestJS  | 4001 | Vendor backend     |
| `vendor-portal`   | Next.js | 3001 | Vendor frontend    |
| `internal-api`    | NestJS  | 4002 | Internal backend   |
| `internal-portal` | Next.js | 3002 | Internal frontend  |

Both APIs serve under the global prefix `/api/v1`.

## The vendor / internal boundary — `ADR-01`

The two sides are separate applications on purpose. A transporter must never learn who the client is, what we charge them, or what anyone else quoted (FSD `NFR-02`, `BR-55`, `D-38`) — and the cheapest way to guarantee that is to make a leak require deliberate work rather than forgetfulness.

| Boundary | What it buys |
| --- | --- |
| Separate Next.js apps | No shared layout, navigation or component that could render a client name. No `if (isTransporter)` branch to get wrong |
| Separate NestJS apps | A vendor request never enters a process with internal controllers loaded |
| Separate deployables | The portal can be rolled back or firewalled on its own |
| Separate Postgres roles | `vendor_api` gets column-level `GRANT`s only. It cannot read `client_id` or `sell_rate` at all |

The two sides share **the database and `packages/*` types. Nothing else.** `packages/*` is types and enums only — no runtime, and no package until a second consumer actually needs a symbol.

Specs: `docs/specs/SPEC-1-vendor-portal-fullstack_1.md` §1.2, `docs/specs/SPEC-2-internal-console-fullstack.md` §1.

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

## Internal console — status

**The frontend is built.** All 47 routes of `docs/specs/internal-spec/01-C1-foundation.md` §1.1 exist, typecheck and build. The backend does not exist yet.

Until it does, the portal runs against a fixture adapter that returns the exact shapes `internal-api` must return:

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
