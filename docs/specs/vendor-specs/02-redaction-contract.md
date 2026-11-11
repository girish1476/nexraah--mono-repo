# 02 · The redaction contract — wave `P1`

**Depends on:** 01
**Delivers:** the DTOs every later part returns, the four layers that make them safe, and the isolation suite that runs on every deploy.

> **This is the most important part in the vendor specification.** Implement it first, test it first. `NFR-02`, `BR-55`, `D-38`.

Everything in parts 03–08 is a screen over one of these DTOs. Build them now and each later screen inherits a payload that is already safe. Retrofitting redaction is how the first version leaked.

---

## 1 · The only shape a transporter may receive for a load

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
  bidMax:          number | null // paise
  advancePct:      number
  remarks:         string | null
  myQuote:         { amount: number; status: string } | null
}
```

**Absent by construction — not optional, not nulled, not hidden:**

`clientId` · `clientName` · `sellRate` · `quoteCount` · `otherQuotes` · `margin` · `sourcingRate` · `branchTarget` · anything about another vendor.

`code` is the indent code `IND-`, not `LD-`. `LD-` is the lead series (FSD B6) and belongs to a different entity entirely — using it here would be a wrong reference, not a redaction failure, but it is the kind of mistake that survives review.

`myQuote` is the only field that reflects any quote at all, and it reflects exactly one: theirs.

## 2 · The lorry receipt DTO

The LR is visible (`BR-54`, `D-36`) because the transporter physically carries it and could not otherwise see what they are carrying.

```ts
interface PortalLorryReceiptDTO {
  lrNo, tripNo, lrDate, bookedAt, branch
  originCity, destCity
  goodsDescription, materialType, packageType, quantity, actualWeightTn, grossWeightTn
  vehicleNo, vehicleType, capacityTn, bodyType
  driverName, driverPhone, driverLicence
  ewayNo, ewayValidTill
  transitDays, remarks
  freight:        number      // paise — THEIR awarded rate
  advancePaid:    number      // paise
  balanceDue:     number      // paise
  status:         'BOOKED' | 'RELEASED' | 'IN_TRANSIT' | 'DELIVERED'
  barcodePayload: string      // Code 39 of lrNo
  pdfUrl:         string      // signed, 15-minute expiry
}
```

**Absent:** `consignor`, `consignee`, `clientName`, `clientInvoiceNo`, `clientInvoiceValue`, `sellRate`.

> **The printed document does show consignor and consignee.** It must — legally, the LR is the contract of carriage and names both parties. The portal does not surface them because **the portal is a searchable record and the paper is not.** A driver holding one LR learns one consignee; a transporter with a portal login and a script learns our entire client list. That asymmetry is the whole argument, and it is why `pdfUrl` is a signed 15-minute URL to a server-rendered document rather than a client-side render of this DTO.

## 3 · The four enforcement layers

Each layer catches what the one above it might miss. None is sufficient alone.

| Layer | Mechanism | Catches |
|---|---|---|
| **Database** | `portalPool` authenticates as `vendor_api`, column-level grants only (part 01 §1.2). `PortalModule` binds it; no portal repository can name `internalPool`. Forbidden columns are unreadable by the credential the query runs under | A service that selects `*` |
| **Process** | `/portal/*` requires `X-Portal-Service`; every other internal route rejects that key. `vendor-api` proxies `/portal/*` and nothing else, so no internal path is internet-reachable through the vendor edge (`ADR-02`) | A route added to the wrong module |
| **Repository** | Every query scoped `WHERE vendor_id = ctx.vendorId`. No override parameter | Vendor A reading vendor B's row on a column both may see |
| **Serialisation** | Explicit DTO classes with `@Expose()`. **Never return an entity directly** | A column later granted for one purpose leaking into an unrelated response |

> **What `ADR-02` changed here.** The database layer used to rest on the operating system: a different process held a different Postgres login. It now rests on `internal-api`'s module wiring — same credential, same grants, same raised error, but a binding rather than a process boundary. That is weaker, and it is why §3.1 of the ADR makes the binding structural and why assertion 6 below gained a runtime half. The process layer moved from "internal controllers are not loaded" to "internal routes are not reachable through the vendor edge, and the vendor edge's key is rejected everywhere else".

Plus two process controls:

- **Test** — E2E asserts forbidden keys are absent from the **JSON body**, not merely unrendered. A field that reaches the browser has leaked, whatever the UI does with it.
- **Review** — any PR touching `vendor-api` requires a second reviewer.

### Why `@Expose()` and not `@Exclude()`

Allow-list, never deny-list. `@Exclude()` means a column added next quarter is exposed by default and stays exposed until someone notices. `@Expose()` means it is invisible until someone deliberately names it — the same argument as `ADR-01`, one layer down.

---

## 4 · The isolation suite

**Runs on every deploy, not every release.** Sign in as vendor A and assert:

| # | Assertion | Why this shape |
|---|---|---|
| 1 | `GET /portal/loads` — body contains no `clientName`, `sellRate` or `quoteCount` key **at any depth** | Recurse the JSON. A nested `myQuote.indent.sellRate` passes a top-level check |
| 2 | `GET /portal/trips` — returns only vendor A's trips | Row scoping, not column scoping |
| 3 | `GET /portal/trips/{vendorB_trip}/lorry-receipt` → **404, not 403** | A 403 confirms the trip exists. Never confirm existence |
| 4a | `GET :4001/api/v1/trips`, `/pnl`, `/invoices`, `/compliance` → **404** | The edge proxies `/portal/*` and nothing else. No internal path is reachable from the internet-facing process |
| 4b | Vendor A's token + a valid service key against `:4002/api/v1/trips` → **403 `WRONG_AUDIENCE`** | A transporter principal cannot reach an internal route even from inside the network |
| 4c | A valid service key against any non-portal `:4002` route → **403 `WRONG_AUDIENCE`** | The vendor edge's credential is rejected everywhere except `/portal/*`. Catches a mis-added proxy rule |
| 4d | `/portal/*` **without** `X-Portal-Service` → **403 `SERVICE_KEY_REQUIRED`** | `/portal/*` is not directly internet-reachable |
| 5 | Lorry receipt DTO contains no `consignor`, `consignee`, `clientInvoiceNo` | §2 |
| 6a | As `vendor_api`, `SELECT client_id FROM indents` **raises** | The negative grant test from part 01 |
| 6b | A portal handler issuing `SELECT client_id FROM indents` **raises at runtime**, and `PortalModule`'s `DB` token resolves to `portalPool` | `ADR-02` moved layer one from a process boundary to a module binding. 6a proves the grant; 6b proves the binding. Without 6b the whole layer can be voided by one `internalPool` injection and every other assertion still passes |

Assertions 1 and 5 are written against a **key-walk helper**, not a fixed field list, so a new forbidden field added to §1 or §2 is picked up by adding one string to a constant rather than by remembering to write a test.

Assertion 4 was one line under `ADR-01` — "console routes are not served by this process at all" — and split into four because the guarantee is no longer free. It used to be a property of the deployment; it is now four rules that have to hold.

---

## 5 · Copy is part of the contract

`BR-55` is as much about wording as payload. Three places where a correct payload can still leak:

| Screen | Wrong | Right |
|---|---|---|
| Load filled by another vendor | *"You lost to a lower bid"* | Card silently removed from the list (part 03) |
| Rejected quote | *"Rejected — winning bid ₹39,800"* | **Rejected — [fixed-enum reason]**, e.g. "This lane was awarded elsewhere. The load went to someone else." Never the winning amount or the winning transporter's identity, and never free text — only one of the three enum sentences (part 03; confirmed 2026-09-19, superseding the earlier "no reason ever" position) |
| Below-band quote refused | *"The client is only paying ₹41,500"* | *"Nexraah will not award this lane below ₹38,000 — it would run at a loss for you and for the desk"* (part 03) |

The refusal message quotes `bidMin`, which the transporter is already entitled to see. It never quotes `sellRate`, which they are not.

---

## 6 · Done when

- [ ] `PortalLoadDTO` and `PortalLorryReceiptDTO` exist as `@Expose()` classes in `apps/internal-api/src/portal`
- [ ] No portal endpoint returns an entity; a lint rule or review checklist enforces it
- [ ] Repository scoping is applied in the repository layer with no override path
- [ ] **A lint rule fails the build if anything under `src/portal` injects `internalPool`**
- [ ] All nine isolation assertions pass (1, 2, 3, 4a–4d, 5, 6a, 6b), wired into the deploy pipeline
- [ ] The key-walk helper is driven by a constant list, not repeated per test
- [ ] Second-reviewer rule documented on `apps/internal-api/src/portal` **and** `apps/vendor-api`
