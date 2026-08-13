# Nexraah Spec 1 — Vendor Portal

**Full stack: frontend + backend + mobile shell** · Version 1.1
Companion to *FSD v2.2* and *Spec 2 — Internal Console*

> **Split for building: [`vendor-specs/00-INDEX.md`](vendor-specs/00-INDEX.md).** Those parts are canonical. This file remains the single-file narrative and is not edited further — if the two disagree, a part file wins and this version is stale.

> **Stale as of `ADR-02`.** §1, §1.1 and §1.2 below describe `vendor-api` as a full backend with its own Postgres role. It is not: `internal-api` owns every operation and serves `/api/v1/portal/*`; `vendor-api` is a proxy with no database credentials. The redaction rules, DTOs and screens in §2–§7 are unchanged in substance — only the process they live in moved. Read [`../adr/ADR-02-internal-owns-operations.md`](../adr/ADR-02-internal-owns-operations.md) and `vendor-specs/01-P1-foundation.md` §1 instead.

| | |
|---|---|
| **Who uses it** | Transporters. External. One account per vendor. Hundreds of them. |
| **Platform** | Responsive web, wrapped in an Expo shell. Phone-first — most transporters will never open a laptop. |
| **Scope** | Everything a transporter touches: quoting, their trips, the lorry receipt, the POD, their bill, their fleet, their own file. |
| **Not in scope** | Anything internal. See Spec 2. |

> **The rule this whole spec exists to protect.** A transporter must never learn who our client is, what we charge them, or what anyone else quoted. Every design decision below defers to that. It is `NFR-02`, `BR-55`, `D-38`.

---

## 1 · Architecture

```
vendor-portal        Next.js 14 · port 3001 · its own deployable
                                    ↓ HTTPS, Bearer JWT
vendor-api           NestJS · port 4001 · /api/v1/portal/*
                                    ↓ vendor_api DB role — column-grant scoped
                     Supabase Postgres · Storage
```

**Two applications, four processes** (`ADR-01`). The vendor side is a separate Next.js app and a separate NestJS app from the internal console — not a route group and not a module inside one server. See §1.2.

Optional Expo shell (`P8`, out of FSD scope — see §1.3) wraps `vendor-portal` in a WebView and adds native camera and push. Nothing in §2–§5 depends on it.

**The POD no longer needs the camera.** Dropping the scanner (`D-33`) takes native capture from three screens to two — only the KYC card photo and the geo-stamped selfie remain. POD attachment is an ordinary file input, which works identically in the WebView and in a desktop browser.

### 1.1 Stack

| Layer | Choice |
|---|---|
| Web | `apps/vendor-portal` — Next.js 14, App Router, port 3001. **A separate application from the internal console, not a route group inside it** |
| State | jotai atoms in `src/store/`; axios instance in `src/apis.ts` with the auth interceptor; per-page `apis.ts` + `types.ts` (repo convention, see root README) |
| Forms | react-hook-form + zod — install at `P2`, the first form wave |
| API | `apps/vendor-api` — NestJS, port 4001, every route under `/api/v1/portal` |
| Auth | Supabase Auth; account provisioned by compliance, never self-registered |
| Shared code | `packages/*` workspace — types and enums only, no runtime. Create the first package when a second consumer actually needs a symbol |
| Mobile | *Deferred, see §1.3.* Expo SDK 52 + `react-native-webview` / `expo-camera` / `expo-location` / `expo-secure-store` |

**Not TanStack Query / Zustand.** The repo already standardised on jotai + a root axios instance and the README documents the page-scoped `apis.ts` convention. Adding a second data layer for an app with no screens yet is churn. Revisit only if server-cache invalidation becomes a real pain.

### 1.2 Why the portal is a separate application `ADR-01`

Not a preference. Shared screens with `if (isTransporter)` branching is precisely how client names leak — as the first design review found. Separate apps mean a leak requires someone to deliberately add a field, rather than forget to remove one.

The repo splits this further than the original design asked for, and that is the decision we keep:

| Boundary | What it buys |
|---|---|
| Separate Next.js app | No shared layout, no shared navigation, no shared component that could render a client name. No `(portal)` route group to leak out of |
| Separate NestJS app | A vendor request never enters a process that has internal controllers loaded. Rate limits, CORS and logging are tuned for an external audience without touching the console |
| Separate deployable | The portal can be taken down, rolled back or firewalled independently |
| **Separate Postgres role** | `vendor_api` holds column-level `GRANT`s only — no `SELECT` on `indents.client_id`, `indents.sell_rate`, `quotes` belonging to other vendors. `BR-55` stops being "we remembered to redact" and becomes "the credential cannot read the column" |

The last row is the one that matters. `NFR-02` is the rule the whole FSD defers to; a DTO that forgets an `@Exclude()` is a code review away from leaking, a missing `GRANT` is not. Write the role in the same migration as the tables (`P1`).

**Cost of the split:** shared enums (POD states, trip stages, permission names) and the Postgres schema live in `packages/*` and are consumed by both APIs. One package, types only. Do not create it before there is a symbol to put in it.

### 1.3 The Expo shell is out of FSD scope

FSD `B1` reads: *"A driver-facing mobile application. **The transporter portal is web only in version one.**"* FSD `A10` phase 5 budgets the whole transporter portal at four weeks.

`P8` therefore does not ship without a change request against `B1`. Everything in §2–§7 is responsive web and works in a desktop browser and a phone browser (`NFR-06`) with no shell present. §6 is retained as the design for the shell **if** it is approved; treat `window.NexraahNative` as permanently optional and always render the file-input fallback (§6.2).

---

## 2 · Authentication and accounts

### 2.1 Provisioning

Compliance activates a vendor (`BR-01`), which creates the portal account and sends credentials by SMS through the DLT-registered gateway (`D-31`). **There is no sign-up.**

```
POST /api/v1/vendors/:id/activate        internal, vendor.activate
  → creates auth user, links vendor_users(user_id, vendor_id)
  → sends templated SMS with a first-login link
```

### 2.2 Session

```
POST /portal/auth/login          → Supabase JWT
GET  /portal/me                  → { vendorId, legalName, code, status, permissions }
```

Every subsequent request carries the bearer token. `PortalGuard` resolves `vendorId` from `vendor_users` and injects it into request scope. **A transporter user has exactly one vendor and cannot switch.**

### 2.3 Suspension

If `vendors.status` moves to `SUSPENDED` or `BLACKLISTED`, login still succeeds but every screen shows a banner and all write endpoints return `403 VENDOR_SUSPENDED`. They can still see their open trips and outstanding money — cutting that off creates disputes rather than preventing them.

---

## 3 · The redaction contract

**This is the most important section in the document.** Implement it first, test it first.

### 3.1 The only shape a transporter may receive for a load

```ts
interface PortalLoadDTO {
  code:            string        // IND-4471   — NOT LD-
  originCity:      string
  destCity:        string
  material:        string
  weightTn:        number
  truckType:       string
  pickupDate:      string
  transitDays:     number | null
  reportingRule:   'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED' | null
  reportingAt:     string | null
  branch:          string
  bidMin:          number | null // paise
  bidMax:          number | null
  advancePct:      number
  remarks:         string | null
  myQuote:         { amount: number; status: string } | null
}
```

**Absent by construction — not optional, not nulled, not hidden:**

`clientId` · `clientName` · `sellRate` · `quoteCount` · `otherQuotes` · `margin` · `sourcingRate` · `branchTarget` · anything about another vendor.

### 3.2 The lorry receipt DTO

The LR is visible (`BR-54`, `D-36`) because the transporter carries it. Redacted:

```ts
interface PortalLorryReceiptDTO {
  lrNo, tripNo, lrDate, bookedAt, branch
  originCity, destCity
  goodsDescription, materialType, packageType, quantity, actualWeightTn, grossWeightTn
  vehicleNo, vehicleType, capacityTn, bodyType
  driverName, driverPhone, driverLicence
  ewayNo, ewayValidTill
  transitDays, remarks
  freight:        number      // THEIR awarded rate
  advancePaid:    number
  balanceDue:     number
  status:         'BOOKED' | 'RELEASED' | 'IN_TRANSIT' | 'DELIVERED'
  barcodePayload: string      // Code 39 of lrNo
  pdfUrl:         string      // signed, 15-minute expiry
}
```

**Absent:** `consignor`, `consignee`, `clientName`, `clientInvoiceNo`, `clientInvoiceValue`, `sellRate`.

The printed document the driver carries **does** show consignor and consignee — it must, legally. The portal does not surface them, because the portal is a searchable record and the paper is not.

### 3.3 Enforcement

| Layer | Mechanism |
|---|---|
| Database | `vendor_api` Postgres role, column-level grants only. The forbidden columns are not readable by the credential the process holds (`ADR-01`) |
| Process | `vendor-api` is a separate NestJS app; internal controllers are not loaded in it and cannot be reached from port 4001 |
| Repository | Every portal query scoped `WHERE vendor_id = ctx.vendorId`. No exceptions, no override parameter. |
| Serialisation | Explicit DTO classes with `@Expose()`. **Never return an entity directly.** |
| Test | E2E asserts forbidden keys are absent from the JSON body, not merely unrendered |
| Review | Any PR touching `portal/` requires a second reviewer |

---

## 4 · Screens

Bottom tabs: **Loads · Quotes · Trips · Fleet**. Profile sits in the header account menu — four tabs is the ceiling on a phone.

### 4.1 Available loads — `/portal/loads`

`GET /portal/loads?truckType=&branch=`

Returns open indents matching the vendor's operating states and fleet types. Card per load.

**Shown:** code, lane, material, weight, truck type, pickup date, transit days, reporting rule, branch, **bid band**, advance %.

**States**

| State | Presentation |
|---|---|
| Not yet quoted | "Place a quote" primary |
| Quoted | Amber pill "Quoted ₹40,800", card muted |
| Awarded to them | Mint pill "Awarded", link to the trip |
| Filled by someone else | Card removed from the list — never "you lost to a lower bid" |

**Empty:** *"No loads match your fleet right now. Keep your truck availability current and new loads will appear here."*

### 4.2 Place a quote — `/portal/loads/[code]/quote`

`POST /portal/loads/:code/quote`

| Field | Type | Req | Validation |
|---|---|---|---|
| Your rate | money | ● | **Below `bidMin` → rejected** (`BR-05`). Message: *"Nexraah will not award this lane below ₹38,000 — it would run at a loss for you and for the desk."* |
| Truck offered | select | ● | Own fleet, status `AVAILABLE` only |
| Remarks | textarea | ○ | |

**Band verdict** — shown live as they type, three states:

| Rate | Verdict | Copy |
|---|---|---|
| Below `bidMin` | Blocked, red | Submit disabled |
| Within band | Mint | *"Within the band. The desk can award this to you without any approval."* |
| Above `bidMax` | Amber, allowed | *"Above the band. This needs Leadership approval and usually loses to an in-band quote."* |

> **`Q-16` is closed — this design was right.** FSD v2.2 answers it as `D-39` and rewrites `BR-05` to match: below-band refused at entry, above-band accepted, stored and flagged, with leadership approval required to *award* it (`BR-40`). Above-band quotes are kept rather than discarded because they are the honest market rate on a lane — the evidence that turns repeated placement failure into a recorded market gap (`D-19`). No change to this screen; the warning copy above is now the specified behaviour rather than a bet on it.

`409 QUOTE_EXISTS` if they already quoted — the screen shows the existing quote with a withdraw option.

### 4.3 My quotes — `/portal/quotes`

`GET /portal/quotes?status=`

Table: load code · lane · your rate · truck offered · submitted · status.

Statuses: **Submitted** (blue) · **Accepted** (mint, with pickup date and "report by") · **Rejected** (grey) · **Withdrawn** (grey). Rejected never says why — that would leak the winning price.

### 4.4 Trips — `/portal/trips`

`GET /portal/trips?status=`

Awarded consignments. Card: trip number, LR number, lane, vehicle, status, and **what is owed on it**.

Each opens to three actions: **lorry receipt**, **proof of delivery**, **raise your bill**.

### 4.5 Lorry receipt — `/portal/trips/[id]/lorry-receipt`

`GET /portal/trips/:id/lorry-receipt` → `PortalLorryReceiptDTO`

Centred LR number in mono, Code 39 barcode, "Released to you" pill. Key-value panel of booking, lane, goods, weight, vehicle, driver, transit days, e-way number and validity. Then **Your freight**: agreed freight, advance paid, balance on POD.

Actions: **Download PDF** (primary, signed URL) · **Share** (secondary — optional, `BR-22`).

Note: *"Carry a printed copy. The barcode is scanned at checkposts and at the consignee."*

### 4.6 Attach the proof of delivery — `/portal/trips/[id]/pod`

`POST /portal/trips/:id/pod` — `BR-51`, `D-33`

**No scanner, no edge detection.** A file input.

| Field | Type | Req | Validation |
|---|---|---|---|
| Files | file[] | ● | ≥ 1, image or PDF, ≤ 10 MB each. Every page |
| Courier docket number | text | ● | Mono. *"The branch uses this to match the physical copy when it arrives."* |
| Sent on | date | ● | ≤ today |
| Anything noted on the POD | textarea | ○ | Shortage, damage, detention hours |

**The chain is shown at the top,** with the transporter's own step first: Attach (you) → Received (branch) → Verified (branch) → Approved (branch).

Four steps here, five states in the system (`BR-48`, `D-32`) — the fifth is `PENDING`, before anything is attached, which is the state this screen exists to move them out of. The transporter never sees the word; they see the clock.

**And the clock is stated plainly:**

```
14 days left in the window
Delivered 22 Jul. After 20 days a deduction of ₹100 a day applies,
and past 40 days no balance is paid.
```

Past 20 days this turns red and reads *"₹400 deducted so far — 4 days over."*

> **Attaching does not stop the clock.** The clock stops when the branch logs the physical copy (`BR-49`, `D-35`). The screen must say so: *"The clock stops when we receive the paper copy, not when you attach it."* Hiding that would make the first deduction feel arbitrary.

**Rejected POD** (`BR-52`): banner with the branch's reason, the clock still running, and a re-attach action.

### 4.7 Raise your bill — `/portal/trips/[id]/bill`

`POST /portal/trips/:id/bill` — `BR-53`, `D-37`

**This is the transporter's bill to us**, not our invoice to the client.

Amounts panel (computed, read-only): freight, agreed charges, bill total.

| Field | Type | Req | Validation |
|---|---|---|---|
| Your bill number | text | ● | Mono. Unique per vendor |
| Bill date | date | ● | ≤ today |
| Attach your bill copy | file | ● | Image or PDF |

**Declaration block, always visible:**

```
TAX PAYABLE UNDER REVERSE CHARGE
Do not add GST to this bill. Nexraah accounts for the tax
under the reverse charge mechanism.
```

**Blocked until the POD is approved:**

```
🔒 Not yet submittable
   ✗ Proof of delivery not yet approved
   ✓ Trip delivered
```

On submit, the server computes the balance and records the variance. A mismatch does not reject the bill — it flags it for finance, since the transporter may be right.

### 4.8 Fleet — `/portal/fleet`

`GET|POST|PATCH /portal/fleet`

| Field | Type | Req | Validation |
|---|---|---|---|
| Registration | text | ● | Indian format, unique within vendor |
| Vehicle type | select | ● | Master |
| Capacity (tonnes) | number | ● | > 0 |
| Current city | text | ○ | |
| Status | select | ● | Available · On trip · **Docs due** · Maintenance |
| Free from | date | ◐ | Required when On trip |

**Docs due** (adopted from the design review) surfaces a truck whose papers have lapsed — neither available nor on a trip. Set by the system when RC, insurance, fitness or PUC expires, and it blocks that truck from being offered on a quote.

### 4.9 Profile and documents — `/portal/profile`

Read-only company details. **KYC and legal documents**, each with status and — where rejected — the reason and a re-upload action.

Card photos for PAN and Aadhaar are captured here, as is the geo-stamped selfie (`BR-23`, `D-27`). These are the only two capture screens that would use the native camera — and since the shell is deferred (§1.3), both ship as **file inputs with `capture="environment"`**, which opens the phone camera in a mobile browser. The geo-stamp comes from the browser Geolocation API with the coordinates written into the attachment record. If `P8` is ever approved, `window.NexraahNative` upgrades these two screens and nothing else (§6.2).

Also shows: advance policy %, bank account (masked), and their business with us — trips, value, outstanding.

---

## 5 · Backend

### 5.1 Endpoints

| Method | Path | Permission | Rules |
|---|---|---|---|
| POST | `/portal/auth/login` | — | |
| GET | `/portal/me` | `portal.self` | |
| GET | `/portal/loads` | `portal.self` | `BR-55` |
| POST | `/portal/loads/:code/quote` | `portal.self` | `BR-05` |
| DELETE | `/portal/quotes/:id` | `portal.self` | Withdraw, only while `SUBMITTED` |
| GET | `/portal/quotes` | `portal.self` | |
| GET | `/portal/trips` | `portal.self` | |
| GET | `/portal/trips/:id/lorry-receipt` | `portal.self` | `BR-54` |
| POST | `/portal/trips/:id/pod` | `pod.upload` | `BR-51` |
| POST | `/portal/trips/:id/bill` | `portal.bill` | `BR-53` |
| GET/POST/PATCH | `/portal/fleet` | `portal.self` | |
| GET | `/portal/profile` | `portal.self` | |
| POST | `/portal/profile/documents/:kind` | `portal.self` | `BR-23` |

All paths above are relative to the `vendor-api` global prefix `/api/v1` — `GET /portal/loads` is served at `http://localhost:4001/api/v1/portal/loads`. `vendor-api` exposes **no** route outside `/portal/*`; §2.1's `POST /vendors/:id/activate` is an `internal-api` route, listed here only to show where the account comes from.

### 5.2 Tables touched

`vendors` · `vendor_users` · `vendor_fleet` · `vendor_kyc` · `vendor_documents` · `indents` (read, redacted) · `quotes` · `trips` (read, redacted) · `lorry_receipts` (read, redacted) · `pod_receipts` (write on attach) · `vendor_bills` · `attachments`

**Full DDL: Spec 2 §20.** The portal writes to a subset and reads nothing outside its vendor. Money columns are `bigint` paise throughout (`NFR-09`, Spec 2 §19) — the same unit this document's DTOs already declare in §3.1.

### 5.3 Rules enforced here

| Rule | Where |
|---|---|
| `BR-05` | `QuotesService.submit` — below-band rejected at entry and never persisted; above-band persisted with `band_position = ABOVE_BAND` (`D-39`) |
| `BR-23` | `KycService` — card images mandatory |
| `BR-51` | `PodService.attach` — docket and sent-on mandatory |
| `BR-53` | `VendorBillService.submit` — POD must be `APPROVED` |
| `BR-54` | `PortalService.lorryReceipt` — redacted DTO |
| `BR-55` | `PortalLoadDTO` — fields absent by construction |
| `NFR-02` | `PortalGuard` + repository scope |

### 5.4 Rate limiting

Quote submission: 30/hour per vendor. File upload: 60/hour. Login: 10/15 min per account. A transporter scripting the loads endpoint to watch pricing is the threat here.

---

## 6 · Mobile shell

### 6.1 Native screens

Two only:

| Screen | Uses |
|---|---|
| KYC card capture | `expo-camera` — PAN and Aadhaar cards |
| Geo-stamped selfie | `expo-camera` + `expo-location` |

### 6.2 The bridge

```ts
// web → native
window.NexraahNative?.capture({ kind: 'KYC_PAN' | 'KYC_AADHAAR' | 'SELFIE', vendorId })

// native → web
webview.postMessage({ type: 'capture.done', attachmentId, kind })
```

**The web must degrade.** When `NexraahNative` is undefined — desktop browser — fall back to a file input. Never a dead button.

### 6.3 Other shell responsibilities

- Session in `expo-secure-store`, injected on WebView load. **Never a token in a URL.**
- Push notifications via Expo, deep-linking to the relevant screen.
- Offline: read-only cache of the last loaded lists with an offline banner. **No queued writes** — a queued quote submitted three hours late against a filled load is worse than an error.
- Bottom tabs rendered natively for speed.

---

## 7 · Notifications

All through the DLT-registered gateway (`D-31`). Templates registered against the DLT entity.

| Event | Trigger | Channel |
|---|---|---|
| `vendor.activated` | Compliance clears the file | SMS |
| `load.published` | New indent matching their states and fleet | SMS |
| `quote.awarded` | Their quote wins | SMS + push |
| `lr.released` | LR issued | WhatsApp with document |
| `pod.due` | Day 15 | SMS |
| `pod.breached` | Day 21, then weekly | SMS |
| `pod.rejected` | Verification fails | SMS + push |
| `pod.forfeit_warning` | Day 35 | SMS |
| `payment.released` | Advance or balance paid | SMS with UTR |

**No promotional messages.** Every template above is transactional under the DLT registration.

---

## 8 · Testing

**The isolation test runs on every deploy.** Sign in as vendor A and assert:

1. `GET /portal/loads` — response body contains no `clientName`, `sellRate`, `quoteCount` key at any depth
2. `GET /portal/trips` — returns only vendor A's trips
3. `GET /portal/trips/{vendorB_trip}/lorry-receipt` → **404, not 403** (never confirm existence)
4. `GET /trips`, `/pnl`, `/invoices`, `/compliance` → 403
5. Lorry receipt DTO contains no `consignor`, `consignee`, `clientInvoiceNo`

**Flow tests:** quote below band rejected · quote above band accepted with the leadership warning · POD attach requires docket and sent-on · bill blocked until POD approved · suspended vendor can read but not write · fleet vehicle with `DOCS_DUE` cannot be offered on a quote.

---

## 9 · Build order

| Wave | Deliverable |
|---|---|
| **P1** | Auth, `/portal/me`, `PortalGuard`, repository scoping, **the redaction DTOs and their tests** |
| **P2** | Loads, quote submission, my quotes |
| **P3** | Fleet inventory |
| **P4** | Trips, lorry receipt |
| **P5** | POD attachment |
| **P6** | Raise your bill |
| **P7** | Profile, KYC documents |
| **P8** | *Blocked* — Expo shell, native capture, push. Needs a change request against FSD `B1` (§1.3) |

**Cross-app dependencies.** The portal cannot be built ahead of the console waves it reads from: `P2` needs `C2` (vendor activation, `BR-01`), `P4` needs `C4` (trip + LR), `P5` needs `C5` (the receiving register — attachment alone stops no clock, `D-35`), `P6` needs `C5`+`C6` (POD approved, balance computed).

**P1 before anything else.** Build the redaction contract and its tests first, so every screen after it inherits a payload that is already safe. Retrofitting redaction is how the first version leaked.
