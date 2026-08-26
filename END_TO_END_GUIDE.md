# Nexraah — End-to-end guide

This is the practical guide to running Nexraah, understanding what each screen is
for, and walking a shipment through the system from a client's request to the
transporter getting paid. For the API contracts, database setup, and formal
business-rule references (`BR-xx`, `NFR-xx`, `D-xx`), see `docs/`. This guide is
about *using* the app, not the wire format behind it.

For the **flows** — every handoff, which desk picks a record up next, what unblocks a
gate, and what moves on its own — see [`FLOWS.md`](FLOWS.md), the flow companion to
this guide.

## 1. What Nexraah is

Nexraah is a freight brokerage platform. A client needs goods moved; Nexraah
finds a transporter (vendor) to move them, prices the job so it's profitable,
and manages the money on both sides — what the client owes Nexraah, and what
Nexraah owes the transporter. There are two audiences, and therefore two
frontends:

- **Internal console** (`internal-portal`) — the ops, compliance, and finance
  teams who run the business. Sees everything: client identities, sell rates,
  margins, every transporter's quotes.
- **Transporter portal** (`vendor-portal`) — the trucking companies who carry
  the freight. Sees only their own loads, their own quotes, and their own
  money. Deliberately **never** sees the client's name, what the client was
  charged, or what other transporters quoted — see §7.

Both talk to one backend (`internal-api`) which owns every read and write.
`vendor-api` is a thin, database-less proxy that terminates the external
transporter traffic and forwards it — see the root `README.md`'s ADR-02
section for why that boundary exists.

## 2. Running it

```bash
pnpm install

# vendor-api + vendor-portal (transporter side)
pnpm dev:vendor

# internal-api + internal-portal (ops side)
pnpm dev:internal

# everything
pnpm dev
```

| App | URL | Notes |
|---|---|---|
| `internal-portal` | http://localhost:3002 | ops console |
| `vendor-portal` | http://localhost:3001 | transporter portal |
| `internal-api` | http://localhost:4002/api/v1 | 21 modules live; transporter surface is read-only so far |
| `vendor-api` | http://localhost:4001/api/v1 | proxies `/portal/*` to internal-api only |

`internal-api` is a working backend now — every internal module is implemented,
and the transporter surface serves its eight read routes (loads, quotes, trips,
lorry receipt, fleet, profile). What it does *not* yet serve is the transporter
**writes**: submitting or withdrawing a quote, uploading proof of delivery,
raising a bill, changing fleet, uploading a document.

So both frontends still run against fixture data by default, and will until
those writes land:

- `internal-portal`: `NEXT_PUBLIC_USE_MOCKS` — defaults **on**. Copy
  `apps/internal-portal/.env.local.example` to `.env.local` to make that explicit.
- `vendor-portal`: `NEXT_PUBLIC_MOCK` — defaults **off** on purpose (a real
  deployment must never silently fall back to fixtures). For local dev, copy
  `apps/vendor-portal/.env.local.example` to `.env.local` (sets it to `1`) —
  this repo already has that file in place, so `pnpm dev:vendor` works out of
  the box here.

Nothing about how a screen behaves changes based on mock vs. real data — the
mock adapters return the exact shapes the real API contract calls for.

## 3. Signing in and switching roles (internal console only)

`internal-portal` signs in for real, at `/signin`. What happens on submit
depends only on `NEXT_PUBLIC_USE_MOCKS`: with mocks on it checks the six
fixture accounts (password `nexraah`) and mints its own token; with mocks off
the password goes to Supabase Auth, which issues the JWT `internal-api`
verifies against JWKS. The console never issues a token itself either way.

The prototype **role switcher** and the `/dev-login` screen it sat beside are
both gone — `lib/auth.ts` now clears any `localStorage.role` left behind.

Six roles exist, each scoped to what that job actually needs (`docs` calls
this the module matrix, `BR-29`):

| Role | Lands on | Owns |
|---|---|---|
| **OPS** (Operations desk) | `/today` | Vendor onboarding, indents, awards, placement, LRs, transit |
| **COMPLIANCE** | `/compliance` | Vendor clearance, document verification, advance-document checks, contract approval, POD verify/approve |
| **FINANCE** | `/payments/balance` | All payment release, invoicing, receipts, collections |
| **BD** (Business development) | `/rfq` | Rate cards, RFQ pricing and lane build-up, client relationships |
| **LEADERSHIP** | `/home` | Oversight of every desk, approvals, RFQ submission, reporting |
| **ADMIN** (Administrator) | `/admin` | Configuration, users, roles — deliberately locked out of day-to-day operational screens |

**Business development** is the odd one out, deliberately. Every other role owns
a *stage* of the shipment — Operations moves the truck, Compliance clears the
papers, Finance moves the money. BD owns what the lane is **worth**: it builds
the RFQ price, keeps the client's rate card, and holds the relationship the rate
belongs to. It gets `pnl.view_own` because a desk setting prices with no sight
of the margin they produce is guessing.

What it deliberately cannot do is **submit** a price. `rfq.submit` stays with
Leadership, so the desk that proposes a rate is never the desk that commits it
to the client — otherwise an above-band price would carry the same signature
twice.

**Leadership oversees the other desks in fact, not just on paper.** As of
2026-08-26 it holds the operating permissions of Operations and Compliance, and
the compliance queue — previously the one screen in the console it could not
open at all — is now fully reachable. Two consequences worth knowing:

- Leadership **cannot release payments.** `payment.release` sits in a protected
  set with `pod.waive` and `config.manage`, permissions that never belong to two
  roles at once. Overseeing the money and being a second pair of hands able to
  move it are different things, and the payment audit trail is only worth
  reading while exactly one desk can pay.
- Vendor clearance no longer **forces** two desks. Compliance normally does it,
  but Leadership can now clear a vendor alone. The two-person rule on proof of
  delivery is unaffected — it keys on the acting person, not the role, so nobody
  approves what they themselves verified.

A module a role can't reach is **absent from the sidebar entirely**, never
shown greyed-out — if you don't see "Payments" as OPS, that's correct, not a
bug. A module you can *see but not edit* still shows in the sidebar (tagged
"Read") and the page itself renders every control, disabled, with a
"Read-only for OPS" badge — the point is you can see state without being
tempted to think a hidden control means broken UI.

Two divisions of labour are worth spelling out, because they look like
duplication until you see the seam:

- **Operations onboards a vendor; Compliance clears them.** Ops can open a
  vendor record and fill in everything about them. Only Compliance can mark the
  documents verified and activate the vendor. The desk that recruits a
  transporter is not the desk that vouches for them.
- **Compliance checks the advance documents; Finance releases the money.** Both
  see the payment screens. Only Finance holds `payment.release`, and that
  permission never moves to a second role — so Compliance can clear a document
  checklist without ever being able to pay against it.

Vendor-portal has no roles — you're always "the vendor," full stop.

## 4. The internal console, module by module

The sidebar groups mirror the natural order goods move through the business:
**Supply** (who can carry it) → **Demand** (who wants it carried) → **Execution**
(carrying it) → **Money** (getting paid) → **Governance** (keeping it honest).

### Supply
- **Compliance desk** (`/compliance`) — vendor document verification and
  contract approval queue. An uncleared vendor can't be assigned a load —
  this is the gate the entire supply side hangs on.
- **Vendors** (`/vendors`) — the transporter directory: fleet size, trip
  count, our margin on them, advance policy, verification status.
  Sub-pages: **Leads** (prospective transporters), **Market gap** (lanes that
  keep drawing no in-band quotes — a recruitment problem, not a pricing one),
  **Issues** (POD delays, vehicle condition complaints, logged against a
  vendor's record).
- **Telematics** (`/telematics`) — live vehicle tracking signal: overspeed,
  long halts, vehicles that have gone dark.

**Where vehicles come from — "supply source".** A branch does not source trucks
one way. Some lanes are served by the local **transport union**, some off the
**open market**, some by **direct owners** we contract with, and most branches
are a mix of the first two. That answer changes how a lane is priced, who to
call when placement fails, and whether a market gap is a recruitment problem or
a rate problem — and until recently it lived only in people's heads.

It is now recorded in three places, because it is decided at three moments:

| Where | When it's set | Why there |
|---|---|---|
| **Branch** (`/admin/branches`) | The branch's overall posture | What a branch-scoped operator sees at a glance for their region |
| **RFQ lane** (sourcing screen) | While sourcing a lane | Sourcing is the moment you actually learn whether a lane is union or market |
| **Rate card lane** (client rate sheet) | Carried across on award | The agreed basis for the price on the sheet |

Every one of them also takes free-text **remarks**, and neither field is ever
required. "Not recorded" is a real, visible state — an operator has to be able
to see that nobody has answered the question yet. And the four values cannot
express something like *"union only during cane season"*, so forcing a wrong
choice would lose more than an empty column does.

### Demand
- **Clients** (`/clients`) — who's shipping with us: contacts, credit terms,
  outstanding balance.
- **RFQ** (`/rfq`) — winning a *lane* (a recurring origin→destination
  relationship with a client) at a price it can actually be served at.
  Lifecycle: `DRAFT` → `SOURCING` (checking what transporters would carry it
  for) → `QUOTED` → `SUBMITTED` to the client → `AWARDED` or `LOST`. This
  happens **before** any individual shipment — it's how a lane becomes
  available to raise indents against.
- **Indents** (`/indents`) — an individual shipment request: one truck, one
  lane, one pickup date. "Raise an indent" captures the requirement (client,
  route, material, weight, truck type, pickup date), the pricing (what we
  charge the client), and placement terms (the price band a transporter's
  quote must fall within, and the advance %). Once published, the band
  becomes read-only — widening it later to force a match is exactly the
  shortcut this rule exists to block; a lane that keeps missing its band is a
  market-gap problem, not a pricing-tweak problem.

### Execution
- **Trips** (`/trips`) — once a transporter is awarded an indent, it becomes
  a trip: `PLACED` → `REPORTED` → `LOADED` → `IN_TRANSIT` → `DELIVERED` →
  `CLOSED`, tracked alongside a parallel POD status. The trip record carries
  the Lorry Receipt (LR), charges, and documents.
- **POD receiving** / **POD pending** (`/pod/receiving`, `/pod/pending`) —
  proof of delivery: receiving the physical/scanned document, verifying it,
  and tracking the clock (see §6) that determines whether a penalty accrues
  on the transporter's balance.

### Money
- **Advance** / **Balance** (`/payments/advance`, `/payments/balance`) — the
  two payment gates. Advance releases against a document checklist (driver
  licence, etc.) before the truck moves; balance releases only after POD is
  approved. Both render as a table with an explicit **unmet-conditions
  checklist** per blocked row — never a bare "blocked" pill with no reason.
- **Transporter bills** (`/payments/bills`) — the transporter's own invoice
  against a trip; a bill above the computed balance is *flagged*, not
  auto-rejected, because the transporter's number might be the correct one.
- **Invoices** (`/invoices`) — what we bill the *client*.
- **Receivables** (`/receivables`) — what clients still owe us.
- **P&L** (`/pnl`) — margin by branch/lane/client, for the people who need to
  see whether the business side of this is working.

### Governance
- **Approvals** (`/admin/approvals`) — anything that needed a second sign-off
  (an above-band price, a penalty waiver, an exception) waits here rather
  than silently going through.
- **Control panel** (`/admin`) — module on/off toggles, the advance document
  checklist, default advance %/credit days/SLA hours, POD penalty settings,
  company letterhead details, and the gap-free numbering series for LR/
  invoice/indent codes.
- **Roles matrix** (`/admin/roles`) — the module-access table in §3, as a
  real screen.
- **Branches** (`/admin/branches`) — your offices, their catchment radius, and
  where each one actually finds trucks (see the supply-source note above).
  Every branch selector in the console — vendor onboarding, indent intake —
  reads this list, so opening a branch here makes it available everywhere
  immediately.
- **Import** (`/admin/import`) — bulk data import.

**Today** (`/today`) and **Home** (`/home`) are the two landing dashboards,
not modules in their own right: **Today** is a worklist — indents waiting on
allocation, placement failures, overdue PODs, open vendor issues — everything
that needs a decision *today*. **Home** is the monthly business review —
branch-by-branch trips, revenue, cost, margin %, and revenue share.

## 5. The transporter portal, screen by screen

Four tabs, phone-first (this is a driver-facing tool as much as an
office one):

1. **Loads** — shipments open for a quote, matched to the transporter's fleet
   and lanes. Quoting below the price band is refused client-side *and*
   server-side — a below-band quote never even reaches the "submitted"
   state. Quoting above the band still submits, but is held for approval
   rather than auto-accepted.
2. **Quotes** — every quote the transporter has placed: open, won, lost, or
   withdrawn. A lost quote states a fixed reason (`AWARDED_ELSEWHERE`,
   `INDENT_CANCELLED`, `EXPIRED`) — never a price, never a competitor.
3. **Trips** — won loads in motion. Each trip card leads with what's owed:
   advance status (and, if blocked, exactly which documents are missing),
   balance due, and the POD clock. From here: view/share the Lorry Receipt,
   upload proof of delivery, and once POD is approved, raise a bill.
4. **Fleet** — the transporter's own vehicles: registration, capacity,
   current city, availability status. `DOCS_DUE` (an expired compliance
   document) is set by the server only — a transporter can't clear it by
   picking a different status; they have to re-upload the document under
   Profile.

A fifth screen, **Profile**, sits behind the header's account link rather
than a tab (four is the limit for a bottom tab bar) — company details, KYC
documents (with per-document status and rejection reasons), and business
summary (trips, value, outstanding).

## 6. One shipment, start to finish

Tying §4 and §5 together — this is the lifecycle a single load actually goes
through:

1. **Client relationship exists**, or an **RFQ** wins a new lane at a
   workable price (internal console).
2. Ops **raises an indent** against that lane: route, material, weight,
   pickup date, sell rate, and a placement band (internal console).
3. The indent becomes visible to transporters as an **available load**
   (transporter portal). One or more transporters **quote**.
4. Ops **awards** the best in-band quote (or an above-band one, with
   approval). The indent becomes a **trip**; the winning transporter sees it
   under Trips, everyone else sees a **lost** quote with no pricing detail.
5. Ops (or the system, once wired) issues the **Lorry Receipt**. The
   transporter can view/share/print it.
6. The **advance** releases once the document checklist clears (internal
   console payments gate; transporter portal shows the same checklist from
   their side).
7. The truck moves: `REPORTED` → `LOADED` → `IN_TRANSIT` → `DELIVERED`.
8. The transporter **uploads POD** (courier docket + sent-on date + photos).
   This does **not** stop the clock — only the branch physically receiving
   the paper copy does. From `DELIVERED`, the transporter has 20 days before
   a ₹100/day deduction starts accruing against their balance, and 40 days
   before the balance is forfeited outright (compliance/operations
   verify and approve POD on the internal side).
9. Once POD is **approved**, the **balance** payment gate opens. The
   transporter can also now **raise a bill** — if their number differs from
   the computed balance, it's flagged for review, not rejected outright.
10. Finance **invoices the client** and tracks the receivable until it's
    collected. The trip closes. P&L reflects the margin.

## 7. The one rule that shapes both frontends

A transporter must never learn who the client is, what Nexraah charged them,
or what any other transporter quoted. This is why the two portals are
**separate Next.js apps** rather than one app with role-based rendering —
there's no shared layout or component that could accidentally leak a client
name into a transporter's screen. It's also why `vendor-api` holds no
database credentials at all: even a bug in its code has nothing to leak,
because it never has the data in the first place. If you're extending
`vendor-portal`, treat any new field touching client identity, sell rate, or
another transporter's data as a hard stop, not a code-review nitpick.

## 8. Mobile / small screens

Both portals are usable on a phone:

- `vendor-portal` is phone-first by design — a single centered column,
  bottom tab bar, sticky action buttons.
- `internal-portal` is a data-dense desktop console by default, but below
  900px width the sidebar becomes a slide-out drawer behind a hamburger
  button in a top bar, and every data table collapses from a grid into
  stacked cards (each cell keeps its column label) rather than forcing
  horizontal scrolling.

## 9. Testing

```bash
# from the monorepo root
pnpm test          # unit/component tests, both portals (Vitest + React Testing Library)
pnpm test:e2e       # end-to-end tests, both portals (Playwright, against mock data)

# from an individual app (apps/internal-portal or apps/vendor-portal)
pnpm test           # vitest run
pnpm test:watch     # vitest, watch mode
pnpm test:e2e       # playwright test
pnpm test:e2e:ui    # playwright test --ui (interactive runner)
```

E2E tests run against the mock adapters (the same fixture data you see in
local dev) via each app's `playwright.config.ts`, which starts the dev
server for you if one isn't already running. `internal-portal`'s suite
covers the RBAC module matrix (which sidebar items and lock panels each role
sees — pinned test-by-test against the matrix in `lib/permissions.ts`), the
mobile nav drawer, and each business module. `vendor-portal`'s suite
includes explicit checks that no client/pricing/competitor data ever
renders on that side, on top of the load→quote→trip→POD→bill flow.

Playwright is configured with two projects per app — `chromium` (desktop)
and `mobile` (a 390×844 Chromium viewport) — using Chromium for both rather
than the WebKit-based iPhone device preset, since these tests are about our
own responsive layout, not cross-browser rendering.

`apps/vendor-portal/scripts/check-pod-clock.mjs` (`pnpm --filter vendor-portal
check`) is a older, dependency-free standalone check of the POD penalty
clock math — kept alongside the newer `pod-clock.test.ts` Vitest suite,
which covers the same boundaries plus a few more.

**If you're running a full E2E suite locally and see a wall of unrelated
failures** (connection errors, every dynamic route stuck on "Signing in…",
every static chunk 404/500ing), don't start debugging individual tests —
it's almost always one of two environment problems, not the app:

1. **`next dev`'s on-demand compilation can't keep up with a large parallel
   Playwright run.** Build first and test against that instead:
   `pnpm build && pnpm start`, *then* point Playwright at the running server.
2. **`.next` gets corrupted if a `next dev` process writes into the same
   directory a production build already occupies** — production and dev use
   incompatible artifact layouts, and the symptom is every JS chunk request
   404ing/500ing. Fix: `rm -rf .next`, rebuild clean, and don't run `next dev`
   against that app again until you're done testing the build.

Also worth knowing: `NEXT_PUBLIC_*` variables are baked into the client
bundle **at build time**, read from `.env.local` if present. If `.env.local`
gets pointed at a real backend with mocks off (for someone's own testing) and
you then build without overriding it, your build will silently expect a real
JWT and every mock-backed page will fail with "Missing bearer token." Force
the flag explicitly when you build for E2E instead of trusting whatever
`.env.local` currently holds: `NEXT_PUBLIC_USE_MOCKS=1 pnpm build` (internal-
portal) / `NEXT_PUBLIC_MOCK=1 pnpm build` (vendor-portal).

## 10. Design system notes, if you're adding a screen

- **`internal-portal`**: build from `src/lib/ui.tsx` (`Panel`, `DataTable`,
  `StatStrip`, `Tag`, `Field`, `FormGrid`, `Dialog`, `BlockedPanel`, `Stack`,
  `Split`) and the design tokens in `src/app/globals.css`. Because almost
  every page composes from these primitives instead of hand-rolled markup, a
  change to the shared CSS/components reaches nearly the whole app — that's
  deliberate, keep it that way rather than one-off styling a single page.
- **`vendor-portal`**: build from `src/components/shell.tsx` (`Pill`,
  `Callout`, `Facts`, `Segmented`, `ScreenHeader`, `ActionBar`, `TabBar`) and
  `src/app/globals.css`. Same principle, phone-first.
- Five status tones exist — `mint` (settled, nothing to do), `blue`
  (moving, wait), `flag` (needs your action), `red` (blocked/rejected, fix
  it), `grey` (inactive) — one meaning per colour, everywhere. Don't invent
  a sixth without adding it to the token block first.
- Both apps share the same type scale, radius/shadow/motion tokens, and
  icon-drawing convention (24×24 viewBox, 1.75–1.9 stroke, round caps) —
  match it rather than reaching for an icon library or a one-off style.

## 11. Third-party integrations

`docs/specs/internal-spec/13-cross-cutting.md` §2 ("FSD B7") names eight
integrations the finished product needs, at Low/Medium/High priority. Three
are live today; the rest need something only a human can provide — a real
account signup, a business's own credentials, or physical hardware — and
that gap is worth understanding precisely rather than guessing at.

### Live

| Integration | Where | What it actually does |
|---|---|---|
| **GSTIN check-digit validation** | `internal-portal/src/lib/gstin.ts` | The real GSTIN check-digit algorithm (not just a 15-character shape regex) — catches a mistyped GSTIN offline, no network call, no account. Wired into both onboarding forms that collect one (`vendors/new`, `clients/new`). Advisory only, per spec: warns, never blocks saving. |
| **IFSC bank/branch lookup** | `internal-portal/src/lib/ifsc.ts` | A live call to Razorpay's public IFSC API (`https://ifsc.razorpay.com/{code}`) — free, keyless, CORS-open (`Access-Control-Allow-Origin: *`), so it's called directly from the browser with no backend involvement. Confirms a real bank branch exists for whatever the operator typed and shows the bank/branch/city back for a sanity check, debounced 500ms after the IFSC field matches shape. Wired into `vendors/new`'s Payment step. Advisory: a lookup failure or "not found" never blocks saving — it can't confirm the account number anyway, only that the *branch* is real. |
| **Telematics ping ingest** | `internal-api/src/modules/telematics/` | `POST /telematics/ping` — the real receiving endpoint a GPS/telematics provider's webhook would call: HMAC-SHA256 signature verification over the raw request body (`common/guards/telematics-hmac.guard.ts`), 5-minute clock-skew rejection, refuses a `vehicle_no` not on any open trip. Every accepted ping is stored and re-derives the five `BR-19` alerts (`alert-rules.ts`, a pure function, no DB). `GET /telematics` (the live board) is also live, JWT-guarded. **No provider is actually connected** — this is the pipe, not the water; see below for why that's the honest stopping point today. |

Every integration above shipped with tests: `gstin.test.ts` (10 cases,
including an exhaustive single-character-corruption sweep proving the check
digit catches every possible typo, not just the ones we thought to try),
`ifsc.test.ts` (6 cases, mocked `fetch`), `check-telematics.mjs` (17
assertions covering every alert rule and signature verification/tampering —
`pnpm --filter internal-api check`), plus a live-network e2e test in
`vendors.spec.ts` that hits the real IFSC API rather than a mock.

### Not live, and why — grouped by the actual blocker

**Needs a real account only a human can create** (SMS/WhatsApp/push
gateway, banking APIs, KYC agency, most accounting-export destinations): a
coding agent cannot sign up for a third-party service — that needs email
verification, sometimes a phone number or business KYC, and someone
authorized to accept that vendor's terms of service. "Free tier" doesn't
change this; free still means an account. The moment real credentials exist,
the client/adapter code is the fast part.

**Needs infrastructure that doesn't exist for a fictional fleet** (GPS/
telematics data itself, as opposed to the ping-receiving endpoint above): no
free API produces real truck GPS, because the missing piece was never
software — Nexraah has no physical trucks or drivers to carry a device. The
one realistic future path is the driver's own phone via the `vendor-mobile`
Expo app (already has `expo-location`), pinging the now-live `/telematics/
ping` endpoint directly. That's a real integration for a later session, not
something to fake now.

**Needs government/regulatory registration, not an API key** (NIC e-way
bill, live GSTIN *validity* as opposed to format): NIC is a government
system; access normally goes through a paid GSP intermediary or a
bureaucratic direct application, not a signup. The existing fallback (values
keyed manually onto the trip) already works at zero integration cost — this
was already the documented plan, not a gap this session introduced.

**Deliberately out of scope for v1, per the spec itself** (KYC agency):
`13-cross-cutting.md` already calls for the manual route first — compliance
reviews uploaded documents by eye. Automating it is a config-flag-gated
future accelerator, not a v1 requirement.

If a real account or credential shows up for any of the blocked rows above,
say which one and what the credential is — wiring in the actual API call at
that point is a small, fast follow-up, not a redesign.
