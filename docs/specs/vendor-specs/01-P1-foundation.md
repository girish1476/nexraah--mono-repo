# 01 · Foundation — wave `P1`

**Depends on:** console `C1` (schema, both DB roles, `attachments`, audit — written in one migration)
**Delivers:** a running `vendor-api` and `vendor-portal` where a transporter can log in, see who they are, and reach nothing that is not theirs.
**Ships with:** part 02. `P1` is not done until the redaction contract and its isolation tests pass.

---

## 1 · Architecture

```
vendor-portal        Next.js 14 · port 3001 · its own deployable
                                    ↓ HTTPS, Bearer JWT
vendor-api           NestJS · port 4001 · /api/v1/portal/*
                                    ↓ vendor_api DB role — column-grant scoped
                     Supabase Postgres · Storage
```

**Two applications, four processes** (`ADR-01`). The vendor side is a separate Next.js app and a separate NestJS app from the internal console — not a route group, not a module inside one server.

| Layer | Choice |
|---|---|
| Web | `apps/vendor-portal` — Next.js 14, App Router, port 3001 |
| State | jotai atoms in `src/store/`; axios instance in `src/apis.ts` with the auth interceptor; page-scoped `apis.ts` + `types.ts` |
| Forms | react-hook-form + zod — install at `P2`, the first form wave |
| API | `apps/vendor-api` — NestJS, port 4001, every route under `/api/v1/portal` |
| Auth | Supabase Auth; account provisioned by compliance, never self-registered |
| Shared | `packages/*` — types and enums only. Create the first package when a second consumer needs a symbol |

**Not TanStack Query / Zustand.** The repo standardised on jotai + a root axios instance. Adding a second data layer for an app with no screens yet is churn. Revisit only if server-cache invalidation becomes a real pain.

### 1.1 Why a separate application — `ADR-01`

Shared screens with `if (isTransporter)` branching is precisely how client names leak, as the first design review found. Separate apps mean a leak requires someone to deliberately add a field rather than forget to remove one.

| Boundary | What it buys |
|---|---|
| Separate Next.js app | No shared layout, navigation or component that could render a client name. No `(portal)` route group to leak out of |
| Separate NestJS app | A vendor request never enters a process with internal controllers loaded. Rate limits, CORS and logging tuned for an external audience without touching the console |
| Separate deployable | The portal can be taken down, rolled back or firewalled independently |
| **Separate Postgres role** | `vendor_api` holds column-level `GRANT`s only |

The last row is the one that matters. A DTO that forgets an `@Exclude()` is one code review away from leaking; a missing `GRANT` is not.

### 1.2 The `vendor_api` database role

Written in the **same migration as the tables** (console `C1`). A grant added later is a grant that gets forgotten.

```sql
CREATE ROLE vendor_api LOGIN;

-- Full access to what is theirs
GRANT SELECT, INSERT, UPDATE ON vendor_fleet, vendor_kyc, vendor_documents TO vendor_api;
GRANT SELECT, INSERT              ON quotes, pod_receipts, vendor_bills   TO vendor_api;
GRANT SELECT, INSERT              ON attachments                          TO vendor_api;
GRANT SELECT                      ON vendors, vendor_users                TO vendor_api;

-- Column-scoped on everything else. The absent columns are the point.
GRANT SELECT (id, code, from_city, to_city, material, weight_tn, truck_type,
              pickup_date, transit_days, reporting_rule, branch_id,
              bid_min, bid_max, advance_pct, remarks, stage, vendor_id)
  ON indents TO vendor_api;
-- NOT GRANTED on indents: client_id, sell_rate, sourcing_rate,
--                         rate_card_lane_id, spot_confirmation_attachment_id

GRANT SELECT (id, code, indent_id, vendor_id, vehicle_no, vehicle_type, capacity_tn,
              driver_name, driver_licence, lane, weight_tn, transit_days_required,
              actual_transit_days, remarks, buy_rate, eway_no, eway_valid_till,
              stage, delivered_at, pod_status, pod_received_at, pod_penalty,
              advance_paid, balance_paid)
  ON trips TO vendor_api;
-- NOT GRANTED on trips: client_id, billed

GRANT SELECT (id, code, trip_id, lr_date, booked_at, branch_id, goods, eway,
              vehicle, driver, transit_days, remarks, status, shared_at)
  ON lorry_receipts TO vendor_api;
-- NOT GRANTED on lorry_receipts: consignor, consignee, invoice

REVOKE ALL ON clients, invoices, receipts, rfqs, rfq_lanes, rate_card_lanes,
              trip_charges, payments, audit_events, config, users, roles
  FROM vendor_api;
```

`buy_rate` on `trips` is granted because it is **their** freight — the rate they quoted and won. `sell_rate` on `indents` is not, ever.

> **Verify the negative, not the positive.** The migration test asserts `SELECT client_id FROM indents` **raises** as `vendor_api`. A test that only checks the granted columns work will pass on a role with `GRANT ALL`.

### 1.3 The Expo shell is out of FSD scope

FSD `B1`: *"A driver-facing mobile application. **The transporter portal is web only in version one.**"* FSD `A10` phase 5 budgets the whole transporter portal at four weeks.

`P8` does not ship without a change request against `B1`. Every part 03–08 is responsive web, works in a desktop browser and a phone browser (`NFR-06`), with no shell present. Treat `window.NexraahNative` as permanently optional and always render the file-input fallback. See part 09.

---

## 2 · Authentication and accounts

### 2.1 Provisioning — there is no sign-up

Compliance activates a vendor in the console (`BR-01`), which creates the portal account and sends credentials by SMS through the DLT-registered gateway (`D-31`).

```
POST /api/v1/vendors/:id/activate        internal-api, vendor.activate
  → creates auth user
  → links vendor_users(user_id, vendor_id)
  → sends templated SMS with a first-login link
```

That route belongs to `internal-api` and is listed here only to show where the account comes from. **`vendor-api` exposes no registration endpoint of any kind.** The absence is the control: an account exists if and only if a compliance officer cleared the file, which is `BR-01` reaching all the way to the login screen.

### 2.2 Session

```
POST /portal/auth/login    → Supabase JWT
GET  /portal/me            → { vendorId, legalName, code, status, permissions }
```

Every subsequent request carries the bearer token. `PortalGuard` resolves `vendorId` from `vendor_users` and injects it into request scope.

**A transporter user has exactly one vendor and cannot switch.** There is no vendor selector, no `?vendorId=` parameter, no header override. If `vendor_users` ever returns more than one row for a user, the guard fails closed with `500` rather than picking one — a multi-vendor user is a data bug, and guessing which vendor they meant is how one transporter reads another's loads.

### 2.3 Suspension

If `vendors.status` moves to `SUSPENDED` or `BLACKLISTED`:

- Login still succeeds
- Every screen shows a banner naming the state
- **All write endpoints return `403 VENDOR_SUSPENDED`**
- Reads continue to work

They can still see their open trips and outstanding money. Cutting that off creates disputes rather than preventing them — a transporter owed ₹28,650 who cannot see the amount calls the branch, and the branch has no record of the conversation.

---

## 3 · `PortalGuard` and repository scoping

```ts
@UseGuards(SupabaseJwtGuard, PortalGuard)
@RequirePermission('portal.self')
```

`PortalGuard` does three things, in order:

1. **Resolve** `vendorId` from `vendor_users` for the authenticated user. No row → `403`, not `404` — the caller is authenticated but is not a transporter.
2. **Reject internal principals.** A user holding an internal role must not reach `/portal/*`, even though the same Supabase project issued their token. Fail with `403 WRONG_AUDIENCE`, distinct from a permission failure.
3. **Inject** `ctx.vendorId` into request scope.

**Every portal query is scoped `WHERE vendor_id = ctx.vendorId`.** No exceptions, no override parameter, no admin bypass flag. The scope is applied in the repository layer, never in a controller and never in a service that a future endpoint might forget to call.

Two layers do the same job on purpose: the `GRANT` stops a column being read, the scope stops another vendor's *row* being read. Neither is sufficient alone — column grants would still let vendor A read vendor B's quote amount on a lane they both bid.

---

## 4 · Rate limiting

| Endpoint | Limit |
|---|---|
| Quote submission | 30/hour per vendor |
| File upload | 60/hour per vendor |
| Login | 10 per 15 min per account |

**The threat is a transporter scripting the loads endpoint to watch pricing.** Not fraud — competitive intelligence. A vendor who polls `/portal/loads` every ten seconds learns which lanes go unfilled and how bands move, which is exactly the market knowledge `BR-55` withholds. Rate limit `GET /portal/loads` at 120/hour and log the outliers rather than blocking them; a transporter refreshing hard is usually just keen.

---

## 5 · Done when

- [ ] `vendor-api` runs on 4001, serves `/api/v1/portal/*`, and **no other path**
- [ ] `vendor-portal` runs on 3001 with its own layout, no import from the console app
- [ ] `vendor_api` role exists with column grants; the negative test asserts `SELECT client_id FROM indents` raises
- [ ] `POST /portal/auth/login` returns a JWT; `GET /portal/me` returns the vendor identity
- [ ] `PortalGuard` rejects an internal principal with `403 WRONG_AUDIENCE`
- [ ] A user with two `vendor_users` rows fails closed
- [ ] A `SUSPENDED` vendor reads but cannot write; the banner names the state
- [ ] Rate limits enforced and logged
- [ ] **Part 02's isolation suite passes** — `P1` is not done without it
