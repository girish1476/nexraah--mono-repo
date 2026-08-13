# Nexraah Spec 2 — Internal Console

**Full stack: frontend + backend** · Version 1.1
Companion to *FSD v2.2* and *Spec 1 — Vendor Portal*

| | |
|---|---|
| **Who uses it** | Six internal roles: operations, compliance, finance, branch manager, leadership, administrator |
| **Platform** | Responsive web, desktop-first. Full function on a tablet. Usable on a phone throughout; phone-*optimised* on Today, POD and approvals (`NFR-06`) |
| **Scope** | Everything internal — thirteen modules, the approvals engine, both money gates, reporting |
| **Not in scope** | The transporter portal. See Spec 1 |

> **What this system is for.** It refuses things. It refuses to let a transporter be assigned before compliance clears them, refuses an advance before documents are verified, refuses a balance before a POD is approved, refuses a spot load quoted at a loss. Every refusal must be legible: what is blocked, why, and what would unblock it.

> **Split for building.** This file is now the single-file narrative. The buildable form is `docs/specs/internal-spec/`, thirteen parts plus an index, one per build wave, each carrying its own rules, endpoints, schema slice, tests and done-when. Start at `internal-spec/00-INDEX.md`. If the two disagree, a part file wins.

**Version 1.1.** Sixteen findings from the FSD verification are resolved: the advance document set now matches `BR-58`, the POD chain carries its `Pending` state, the payments API exists, a data model and an audit specification are added, `NFR-05`–`NFR-12` are addressed, and the four missing integrations are scoped. `BR-05` follows `D-39`. Full list in `VERIFICATION-FSD-vs-SPEC-2.md`.

---

## 1 · Architecture

```
internal-portal      Next.js 14 · port 3002              ← this spec
   │  jotai · axios · react-hook-form + zod
   ▼
internal-api         NestJS · port 4002 · /api/v1/*      ← this spec
   │  PermissionsGuard · business rules · audit
   ▼  internal_api DB role — full schema access
Supabase  Postgres · Auth · Storage
```

**Four processes, two boundaries** (`ADR-01`, Spec 1 §1.2). `internal-portal` + `internal-api` are separate applications from `vendor-portal` + `vendor-api` — separate deployables, separate Postgres roles, no shared server process. The two sides share the **database and `packages/*` types, nothing else**: no shared layout, no shared component, no shared controller, no `if (isTransporter)` anywhere.

This spec owns the `internal_api` role, which has full schema access. `vendor_api` holds column-level grants only; adding a column that a transporter must never see requires no change here, because the grant is never issued.

| Layer | Choice |
|---|---|
| Web | `apps/internal-portal` — Next.js 14, App Router, port 3002 |
| State | jotai atoms in `src/store/`; axios instance in `src/apis.ts`; per-page `apis.ts` + `types.ts` (repo convention, root README) |
| Forms | react-hook-form + zod — install at `C2`, the first wizard |
| API | `apps/internal-api` — NestJS, port 4002, global prefix `/api/v1` |
| Shared code | `packages/*` — types and enums only. Create the first package when a second consumer needs a symbol |

**Not TanStack Query / Zustand** — see Spec 1 §1.1.

### 1.1 Route structure

Paths below are under `apps/internal-portal/src/app/`. There is no `(app)` route group — the whole application is the internal console, so a group segment buys nothing.

```
  today/            home/
  vendors/          [id]/ · new/ · leads/ · market-gap/ · issues/
  compliance/
  rfq/              new/ · [id]/ · [id]/lanes/[laneId]/sourcing · /quote · [id]/award
  indents/          [id]/ · new/
  trips/            [id]/ · [id]/documents · [id]/charges · [id]/lr
  pod/              receiving/ · [id]/verify · pending/
  payments/         advance/ · balance/ · bills/
  telematics/
  clients/          [id]/ · new/
  invoices/         [id]/ · new/
  receivables/
  pnl/
  admin/            roles/ · approvals/ · import/
print/              lr/[tripId] · invoice/[invoiceId] · pnl
```

---

## 2 · Roles and access

### 2.1 The six roles

| Role | Lands on | Owns |
|---|---|---|
| `OPS` | `/today` | Indents, awards, placement, LRs, transit |
| `COMPLIANCE` | `/compliance` | Vendor clearance, document verification, contract approval, POD verify and approve |
| `FINANCE` | `/payments/balance` | **All payment release**, invoicing, receipts, collections |
| `BRANCH_MGR` | `/today` scoped | Branch placement performance, margin, RFQ sourcing, POD receive/verify/approve |
| `LEADERSHIP` | `/home` | Approvals, RFQ submission, reporting |
| `ADMIN` | `/admin` | Configuration, users, roles |

Full visibility matrix: **FSD §B2**, reissued in v2.2 with the `ADMIN` column and the five module rows v2.1 omitted.

### 2.2 The three patterns for unavailable

| Situation | Pattern |
|---|---|
| Module the role lacks | **Absent from navigation.** Direct URL → lock panel naming the owning role |
| Action the role lacks | **Control not rendered** |
| Action blocked by state | **Control rendered, disabled, with the checklist of what would unblock it** |

The third is the product. `🔒 Advance blocked — E-way bill uploaded but not verified · Driving licence not uploaded` beats any success state.

### 2.3 Grantable functions

`indent.create` and `document.verify` attach to any internal role (`D-17`, `BR-41`). Seeded to `OPS`; movable in the roles matrix without a deploy.

### 2.4 Seed permission grants

`BR-29` puts None/View/Edit on every module for every role. Beyond that matrix, these named permissions seed as follows. FSD B2 assigns the POD three to *branch or compliance*; v1.0 of this spec named the permissions but never said who holds them.

| Permission | Seeded to | Movable |
|---|---|---|
| `payment.release` | `FINANCE` | **Fixed** (`BR-40`) — not grantable to any other role |
| `indent.create` | `OPS` | Yes (`BR-41`) |
| `document.verify` | `OPS` | Yes (`BR-41`) |
| `vendor.verify` · `vendor.activate` | `COMPLIANCE` | Yes |
| `vendor.advance_policy` | `COMPLIANCE` | Yes — a change still needs approval (`BR-57`) |
| `pod.receive` | `BRANCH_MGR`, `COMPLIANCE` | Yes |
| `pod.verify` | `BRANCH_MGR`, `COMPLIANCE` | Yes |
| `pod.approve` | `BRANCH_MGR`, `COMPLIANCE` | Yes — constrained by `BR-50`, approver ≠ verifier |
| `pod.waive` | `COMPLIANCE` proposes, `LEADERSHIP` approves | **Fixed** (`BR-43`) |
| `rfq.submit` | `LEADERSHIP` | **Fixed** |
| `invoice.create` · `receipt.record` | `FINANCE` | Yes |
| `config.manage` | `ADMIN` | **Fixed** |

Finance holds View on the POD chase list without holding any of the three POD permissions — they need to see the held balance, not to advance the chain.

### 2.5 Guards

```ts
@UseGuards(SupabaseJwtGuard, PermissionsGuard)
@RequirePermission('payment.release')
```

Branch scoping applied at repository level for `BRANCH_MGR` — never in controllers.

`internal-api` serves no `/portal/*` route. A transporter's bearer token is issued by the same Supabase project, so `PermissionsGuard` must reject a principal with no internal role outright rather than falling through to a permission check — a vendor user holds none of the internal permissions, and "no permission" and "wrong audience" should not return the same error.

---

## 3 · The approvals engine

Six actions cannot complete directly (`BR-40`, `BR-57`, `D-16`, `D-22`). Each creates an `approvals` row and returns **`202 APPROVAL_REQUIRED`**, which is **not an error**.

| Kind | Requester | Approver | Rule |
|---|---|---|---|
| `ABOVE_BAND_PRICE` | OPS / BRANCH_MGR | LEADERSHIP | `BR-40`, `BR-05` |
| `ADVANCE_OVERRIDE` | OPS | Senior to OPS | `BR-40` |
| `ADVANCE_POLICY_CHANGE` | COMPLIANCE / OPS | Senior to OPS | `BR-57` |
| `PENALTY_WAIVER` | COMPLIANCE | LEADERSHIP | `BR-43` |
| `DOC_OVERRIDE` | OPS | Senior to OPS | `BR-44` |
| `BRANCH_OVERRIDE` | Any | LEADERSHIP | `BR-47` |

`ADVANCE_POLICY_CHANGE` is new in v1.1. `D-22` requires approval for *"any departure from the standard"* and v1.0 carried no kind for it, leaving `PATCH /vendors/:id/advance-policy` as an unguarded edit. It covers both cases the decision names: compliance changing the standing percentage on a vendor file, and a desk overriding it on one urgent indent. Reason mandatory, ≥ 20 characters.

**Frontend:** the originating control becomes `Awaiting approval` and stays disabled. An amber banner names what was asked and who must approve. No success toast.

**On approval** the original action executes with the original payload. On rejection a note is mandatory and the requester is notified.

```
GET  /approvals?status=pending&kind=
POST /approvals/:id/approve
POST /approvals/:id/reject      { note }   note required
```

The stored payload is replayed **verbatim** on approval, never recomputed — a rate that moved in the interim must not silently change what leadership agreed to. If replay is no longer valid (vendor suspended, indent cancelled) the approval fails closed with `409` and the reason.

---

## 4 · Today — `/today`

`GET /reports/today` · `indent.view`

Three working queues, nothing else. Not a dashboard.

### 4.1 Trips pending allocation

Indents at `OPEN`, earliest pickup first.

**Stats:** waiting · freight at stake · no quotes yet · quotes in · earliest pickup · tonnes
**Charts:** donut by truck type · bars by branch
**Table:** indent (link) · client · lane · load · truck type · pickup · freight · quotes · branch

### 4.2 Placement failures

`stage IN (OPEN, VENDOR_ASSIGNED) AND pickup_date < today` (`BR-18`)

**Stats:** failed · freight lost · worst branch · longest overdue · never quoted · truck no-show
**Causes:** No quote at all · **Only above-band quotes** · Quotes in band, none awarded · Truck never reported · Client cancelled
**Links to** Market gap — a repeat failure on a lane is a recruitment problem (`D-19`, `BR-39`)

*Only above-band quotes* is a distinct cause because under `D-39` those quotes are kept rather than discarded. A lane that repeatedly draws nothing but above-band quotes has a band set below the market — which is precisely the market-gap signal `D-19` depends on, and it is invisible if the quotes are refused at entry.

### 4.3 Vendor issues

Open issues only. Donut by category, bars by transporter, list by severity.

---

## 5 · Home — `/home`

`GET /reports/home?month=` · reporting, not operations.

**Block M — This month.** Month selector. Trips · revenue · transporter cost · gross margin · margin % · vendors used. Daily revenue columns. Revenue-share donut, top five clients. Placement panel: on-time % (mint ≥ 90, amber ≥ 70, red below), placed by pickup date, failures, vendors utilised, distinct trucks, top six destinations. Branch table with share gauge.

**Block P — POD collection.** Delivered · collected · pending · within TAT · breached · collection %. Status donut, pending-by-transporter bars, breached table with penalty accrued.

**Block S — Where things stand.** Standing totals.

---

## 6 · Vendor management

### 6.1 Onboarding — `/vendors/new` · `vendor.edit`

Five-step wizard, draft saved per step.

| Step | Fields | Rules |
|---|---|---|
| **1 Company** | Name ● · base city ● · party type ● (Owner/Vendor) · GSTIN ○ · phone ● unique · alternate ○ | Branch derived, 150 km (`BR-34`). Two branches in range → client operating location decides, leadership may override (`BR-47`). GSTIN checked against GSTN where present — advisory, never blocking |
| **2 Identity** | PAN number ● **+ card photo ●** · Aadhaar OTP ● **+ card photo ●** · address proof ● · geo-stamped selfie ● · trade licence / labour licence / RC / Udyam · TDS declaration ● | RC mandatory for Owner (`BR-02`); else ≥ 1 legal doc. **TDS declaration mandatory for every transporter, whatever the party type** (`BR-03`) — held on file, nothing deducted (`D-24`, `BR-33`). Aadhaar last-4 only (`BR-04`). Images retained for the relationship (`BR-46`) |
| **3 Fleet** | Trucks ● · body type ○ · fleet base ● · operating states ● | |
| **4 Payment** | Account ● · IFSC ● · holder ● · statement ● · **advance policy % ●** | Becomes the vendor default (`BR-30`, `D-22`). Every later change needs approval (`BR-57`) |
| **5 Review** | Verified by ● · remarks ○ | Submitting ≠ activating |

**Verification route** per check: `API` or `MANUAL` (`BR-31`, `D-08`). Manual routes to the compliance queue. Build manual first — no external dependency.

```
POST   /vendors                       draft
POST   /vendors/:id/kyc/:kind         submit
POST   /vendors/:id/kyc/:kind/verify  vendor.verify
POST   /vendors/:id/documents/:kind
POST   /vendors/:id/submit            → PENDING_VERIFICATION
POST   /vendors/:id/activate          vendor.activate → ACTIVE, creates portal account
PATCH  /vendors/:id/advance-policy    vendor.advance_policy → 202 ADVANCE_POLICY_CHANGE
```

### 6.2 Search and detail — `/vendors`, `/vendors/[id]`

Two segments. **Trips & business:** stats, trips table, money with us (advance outstanding, balance pending, penalties accrued), **our margin on their work** — total and per lane — and top lanes. **Vendor file:** KYC with method and verifier, legal documents with validity, advance policy with its change and approval history, fleet.

Margin per vendor is what FSD A6 asks the vendor page for and v1.0 omitted. It is the answer to "is this transporter cheap or just available", and it is the only screen that can show it.

`Clear and activate` enables only on a complete file (`BR-01`) — the gate the entire supply side hangs on.

### 6.3 Leads, market gap, issues

**Leads** `/vendors/leads` — pipeline New → Contacted → Documents requested → Qualified → Converted/Dropped. `Start onboarding` on Qualified opens the wizard prefilled.

**Market gap** `/vendors/market-gap` — per branch: lane under pressure, truck needed, editable target, on panel, converted, gap, progress. Where `D-19` lands.

**Issues** `/vendors/issues` — category, severity, related LR, Open → In progress → Resolved.

---

## 7 · Compliance desk — `/compliance` · `COMPLIANCE`

One queue, three segments with pending counts.

| Segment | Contents | Action |
|---|---|---|
| **Vendor files** | Identity checks and legal documents item by item | Verify each · **Clear and activate** (enabled only on a complete file) |
| **Client contracts** | Agreement, validity, lanes priced | Approve. Warns when no rate card lanes exist |
| **Trip documents** | Grouped **vehicle · driver · client** (`D-09`) | Verify · Verify all · what is not yet attached called out |

---

## 8 · RFQ and rate management — `/rfq`

`D-18`, `BR-36`, `BR-37`, `BR-38`. Entirely new — no prototype precedent.

### 8.1 Flow

```
RFQ received → sourcing rates (ops) → quote build-up → submit → award → rate cards
```

| Screen | Detail |
|---|---|
| **List** `/rfq` | Stats: open RFQs · lanes out to bid · lanes won · lost · win rate · value won. Statuses Draft → Sourcing → Quoted → Submitted → Awarded/Lost → Closed |
| **New** `/rfq/new` | Client ● · cycle ● (3/6/12 months) · period from ● · period to (derived) · submission due ● · reference ○ |
| **Lanes** `/rfq/[id]` | Inline table: origin → destination · truck type · sourcing mode · sourcing avg · overhead · margin · quoted rate · outcome. Add lane captures transit days and reporting rule |
| **Sourcing** `/rfq/[id]/lanes/[laneId]/sourcing` | **Monthly:** a rate per month across the period, average computed. **High/low:** two fields, midpoint. Ops supplies it |
| **Quote build-up** `/rfq/[id]/lanes/[laneId]/quote` | `average sourcing + overhead + margin = quoted rate`, with a stacked bar showing proportions. Quoted rate not directly editable (`BR-36`). Warn below minimum margin %. Bulk-apply overhead and margin across lanes |
| **Award** `/rfq/[id]/award` | Per lane Won/Lost/Withdrawn with awarded rate. **Create rate cards** shows exactly what will be created before writing (`BR-37`) |

```
POST  /rfqs · /rfqs/:id/lanes
PATCH /rfqs/:id/lanes/:laneId/sourcing · /buildup
POST  /rfqs/:id/submit      rfq.submit — LEADERSHIP
POST  /rfqs/:id/award       → rate_card_lanes
```

**The quote build-up is where every rupee of margin is decided.** Each component is stored so a won lane can later be tested against what it actually cost (`R-03`).

---

## 9 · Indents — `/indents`

### 9.1 Raise — `/indents/new` · `indent.create`

**Requirement:** client ● · pickup ● · delivery ● · material ● · weight ● · truck type ● · pickup date ● · **transit days** ◐ · **reporting rule** ◐ (Same day / Next day / Scheduled) · **remarks** ○ · branch derived from the pickup city and carried **unchanged** to the trip and the LR (`BR-20`)

**Pricing — contract:** freight auto-filled from the won RFQ lane. Editing above band → `ABOVE_BAND_PRICE` approval (`BR-40`).

**Pricing — spot:** sourcing rate ● · freight ● **must exceed sourcing** (`BR-38`) with live margin shown · **client rate approval attachment ●** (`BR-26`, `D-14`). Without the attachment the indent cannot be raised.

**Placement terms:** bid min ○ · bid max ○ · advance % ● defaults from the vendor on award (`BR-30`). Setting it away from that vendor's standing policy → `ADVANCE_POLICY_CHANGE` approval (`BR-57`, `D-22`).

### 9.2 Detail — `/indents/[id]`

| Panel | Contents |
|---|---|
| Progress | Raised → Quotes in → Awarded → Placed → Trip created |
| Quotes | Cheapest first: transporter · rate · **band position** · truck · submitted · **Award**. Blocked if vendor not `ACTIVE` (`BR-01`) |
| Documents | Upload/verify — gates the advance. All eight of `BR-58` listed with state, attached or not |
| **Advance** | Blocked panel until documents verify (`BR-07`). Then beneficiary (readonly) · **amount locked** (`BR-08`) · **mode ●** · transfer type ● · remitting account ● · **UTR ●** · value date ● (`BR-09`). Button rendered for **FINANCE only** (`BR-40`) |
| Placement | Record vehicle placed — captures vehicle, driver, licence, reported-at. Late reporting flags transit delay (`BR-42`). Then **Create trip** → generates `TRP-` (`BR-21`) |

**Band position** is one of three (`BR-05`, `D-39`):

| Position | Presentation | Award |
|---|---|---|
| Below `bid_min` | Never reaches the desk — refused at entry in the portal, never persisted | — |
| Within band | Mint | Awards directly |
| Above `bid_max` | Amber `Out of band` pill, kept and shown | `202 ABOVE_BAND_PRICE` → leadership approves → the award then executes |

`D-39` settles what v1.0 left ambiguous. Above-band quotes are kept rather than refused because they are the honest market rate on that lane — the evidence that turns a repeated placement failure into a recorded market gap.

**The band is never widened to force a placement** (`BR-39`) — not before the first quote and not after. v1.0 said "immutable after the first quote", which left the desk free to widen it in exactly the window where it is tempting. Bid min and max become read-only the moment the indent is published; a lane drawing no in-band quote is a market gap, and the fix is recruitment.

**Award writes the buy price.** Awarding a quote assigns that transporter and **writes their quoted rate onto the indent as `buy_rate`** (`BR-06`), at the moment of the decision. Advance, balance, margin and P&L all read that field. It is never reconstructed from a rate card afterwards — FSD A9 §3 names this as the whole difficulty of holding two truths about one load.

---

## 10 · Trips — `/trips`

### 10.1 Search

Global search with field selector: all · LR · trip no · indent · truck · transporter · company · branch. Filters: stage · company · transporter · branch · POD status.

### 10.2 Detail — details tab

Identifiers (trip no, LR no, indent) · consignment · truck & driver with utilisation gauge · **timing** (reporting required vs actual, transit days required vs actual, delay flag) · charges · remarks · milestones.

### 10.3 Documents tab

Five groups, eleven documents. Each Upload → Verify → Verified, or Rejected with reason.

| Group | Documents | Gates the advance (`BR-58`) |
|---|---|---|
| **Client** | Client invoice or purchase order · E-way bill | Both |
| **Vehicle** | Registration certificate · Goods insurance · **Fitness certificate** · **Permit** · **Pollution certificate** | All five |
| **Driver** | Driving licence | Yes |
| **Lorry receipt** | LR | No — issued after placement |
| **POD** | Proof of delivery | No — gates the balance |

Eight of the eleven gate the advance. **Fitness, permit and PUC are in that set** — v1.0 listed only `CLIENT_INVOICE, EWAY_BILL, RC, INSURANCE, DL`, dropping the three the FSD names in A5. An expired fitness certificate is one of the specific examples the FSD gives for Leak 2, and Spec 1 §4.8 already marks a truck `DOCS_DUE` when RC, insurance, fitness or PUC lapses — the data exists at fleet level, the gate simply was not checking it.

The set is **configurable** as `config.advance_document_set`, seeded with those eight. Removing one is an audited configuration change (`NFR-03`).

**Cross-check** (`BR-32`, `D-09`) when client invoice, e-way bill and LR are all present:

| Compared | A | B |
|---|---|---|
| Invoice number · value | Client invoice | LR |
| Vehicle number | E-way bill | LR |
| Consignor GSTIN · consignee | Client invoice | LR |
| E-way validity | E-way bill | ≥ expected delivery |

**Mismatch** → red banner, field-by-field side by side. `Reject and request re-upload` primary; `Override and proceed` requires a reason ≥ 20 chars from a role senior to ops (`BR-44`, `D-28`) and raises `DOC_OVERRIDE`.

> Until OCR exists the uploader keys the values and the system compares them. Still worth doing — most mismatches are typing errors. Once NIC is connected (§21) the e-way side stops being keyed and the check becomes authoritative.

### 10.4 Charge capture — `/trips/[id]/charges`

`BR-45`, `D-25`. Captured **at POD verification**, from what is written on the document (`BR-56`).

| Field | Req | Notes |
|---|---|---|
| Charge type ● | | Loading · Unloading · Labour · Halt · Detention · Other |
| **Cost to us** ● | | Payable to the transporter |
| **Billed to client** ● | | ≥ cost. Warn if below |
| Mark-up | derived | Shown in ₹ and % |

**This is what makes the P&L true.** Trips closed with no charges captured appear in the P&L exception panel (`R-01`).

### 10.5 Lorry receipt — `/trips/[id]/lr`

One record on the trip (`BR-22`). Sections: general · consignor · consignee · shipment · goods · invoice & e-way · vehicle & driver · transit days and remarks · six charge heads. Auto-saves every 3s.

`Generate LR` consumes the number (`BR-14`), blocked until the truck is placed (`BR-13`). Print → `/print/lr/[tripId]`. **Share is optional** (`BR-22`).

**Print layout** (FSD B6) — A4 letterhead carrying company **GSTIN, PAN and CIN** from the control panel, consignor and consignee blocks, goods table, vehicle and driver, charge breakdown across the six heads, terms, a **Code 39 barcode of the LR number**, and **three signature blocks** — consignor, carrier, consignee. The printed copy is the primary form.

---

## 11 · Proof of delivery

The chain has **five states** (`BR-48`, `D-32`): **Pending → Attached → Received → Verified → Approved**, with **Forfeited** terminal outside it past 40 days.

| State | Set by | Clock | Meaning |
|---|---|---|---|
| `PENDING` | System, on delivery | **Running** | Delivered; the transporter has submitted nothing. Every chase-list row starts here |
| `ATTACHED` | Transporter, in the portal | **Still running** (`BR-49`) | Photo or PDF uploaded with courier docket and sent-on date (`BR-51`) |
| `RECEIVED` | Branch · `pod.receive` | **Stopped** | The physical copy arrived and was logged against its docket (`D-35`) |
| `VERIFIED` | Branch or compliance · `pod.verify` | Stopped | Clerical check passed. Charges captured here (`BR-56`) |
| `APPROVED` | Branch or compliance · `pod.approve` | Stopped | The decision to pay. **Only this unblocks the balance** (`BR-10`). Approver ≠ verifier (`BR-50`) |
| `FORFEITED` | System, day 41 | — | Terminal. Balance forfeited, trip closed with nothing payable (`BR-25`) |

`PENDING` is a real state, not an absence — v1.0 omitted it from the chain. The chase list, the penalty accrual and the `pod.due` / `pod.breached` notifications all operate on `PENDING` rows, so a state machine built without it has no initial state.

### 11.1 Receiving register — `/pod/receiving` · `pod.receive`

The physical copy arriving by courier, days after attachment.

**Stats:** attached in transit · received today · awaiting verification · awaiting approval · balance held · past 20 days

**Table:** LR · trip · transporter · delivered · courier docket · attached · day (amber > 20, red > 40) · chain pill · action

**Log a receipt:** courier docket ● (auto-matches the trip) · received on ● · pages ● · received by ● · condition ○

> **Logging receipt stops the penalty clock** (`BR-49`, `D-35`). Attachment does not. If a photograph stopped the clock the paper would never arrive.

### 11.2 Verify and approve — `/pod/[id]/verify`

Two acts, two people (`BR-50`, `D-34`).

**Verify** · `pod.verify` — document viewer with page tabs; checklist: consignee stamp · signed and dated · LR number matches · quantity matches the invoice · no shortage or damage. Remarks mandatory when any check fails. **Charges captured here** (`BR-56`).

`Reject` returns it to the transporter for a replacement and **does not stop the clock** (`BR-52`) — it clears `pod_received_at` and returns the POD to `ATTACHED`, or to `PENDING` where the copy is not coming back.

**Approve** · `pod.approve` — blocked until verification completes **and** the approver differs from the verifier. The database constraint enforces it (§20.6), the service checks it, and the button is not rendered for the verifying user — three layers, because `BR-50` is the one rule a determined branch will try to work around at 6pm.

Approving unblocks the balance; finance still releases it.

### 11.3 Chase list — `/pod/pending`

Oldest first. TAT tag: `{n} days left` mint · `+{n}d over` red · `FORFEITED` red. Penalty accrued column. Filters: branch · transporter · ageing. CSV export honouring filters.

**Waiver** — compliance requests with a reason ≥ 30 chars, leadership approves (`BR-43`, `D-23`).

```
GET  /pod/receiving · /pod/pending
POST /pod/:tripId/receive · /verify · /reject · /approve
POST /pod/:tripId/waive · /waive/approve
```

---

## 12 · Payments · `payment.release` — FINANCE only

`/payments/advance` · `/payments/balance` · `/payments/bills`

Three queues. Each row shows what is releasable, what is blocked, and the checklist of what would unblock it. The panels on `/indents/[id]` and `/trips/[id]` are the same component scoped to one record.

v1.0 specified the arithmetic of both gates but gave no endpoints and no route — the only functional area in the spec without an interface contract, and the one wave C6 is built from.

### 12.1 Advance

```
preconditions: indent VEHICLE_PLACED · trip exists
               mandatory docs VERIFIED                                   BR-07, BR-58
                 CLIENT_INVOICE_OR_PO, EWAY_BILL,
                 RC, INSURANCE, FITNESS, PERMIT, PUC,
                 DRIVING_LICENCE
amount:  gross = buy_rate × advance_pct / 100     locked, not editable   BR-08
         tds   = 0                                                        BR-33, D-24
capture: mode, transfer_type, remitting_account, utr, value_date          BR-09
```

The set is read from `config.advance_document_set`. Any member missing or unverified appears **by name** in the blocked panel — §2.2's third pattern is the product here.

### 12.2 Balance

```
preconditions: trip DELIVERED · pod_status = APPROVED (or WAIVED)         BR-10, BR-48
               all mandatory docs VERIFIED · pod age ≤ 40 days            BR-25
amount:  billable = buy_rate + Σ trip_charges.cost_amount
         gross    = billable − advance_paid                               BR-11
         penalty  = trip.pod_penalty (0 if waived)                        BR-24
         net      = gross − penalty
capture: mode, transfer_type, remitting_account, utr, value_date          BR-09
past 40 days → POD_FORFEITED, trip closed with nothing payable            BR-25
```

**Deduction breakdown must be shown**, not just a net figure:

```
Billable                   ₹41,500
Less advance paid         −₹12,450
Less POD penalty (4 days)    −₹400   ⓘ ₹100/day beyond 20 days
Net payable                ₹28,650
```

### 12.3 Transporter bill matching — `/payments/bills`

`BR-53`, `MOD-VBL`. Bills submitted in the portal appear in a finance queue with the computed balance beside them and the variance flagged. A variance does not reject the bill — the transporter may be right.

**Table:** vendor · their bill number and date · trip · bill total · computed balance · variance in ₹ and % · POD state · attachment · action.

**Actions:** `Accept and release` (releases at the computed figure) · `Accept at their figure` (reason required; raises no approval — finance owns the number under `BR-40`) · `Query` (notifies the transporter with a note, bill stays open).

### 12.4 Endpoints

| Method | Path | Permission | Rules |
|---|---|---|---|
| GET | `/payments/advance?status=` | `payment.release` | Queue: releasable and blocked |
| GET | `/payments/advance/:indentId` | `payment.release` | Computed amount and blocking checklist |
| POST | `/payments/advance/:indentId` | `payment.release` | `BR-07`, `BR-08`, `BR-09`, `BR-58`. `409 ADVANCE_BLOCKED` with the unmet list |
| GET | `/payments/balance?status=` | `payment.release` | |
| GET | `/payments/balance/:tripId` | `payment.release` | Full deduction breakdown |
| POST | `/payments/balance/:tripId` | `payment.release` | `BR-10`, `BR-11`, `BR-24`, `BR-25`. `409 BALANCE_BLOCKED` / `409 POD_FORFEITED` |
| GET | `/payments/bills?status=` | `payment.release` | `BR-53` |
| GET | `/payments/bills/:id` | `payment.release` | Bill beside computed balance, variance |
| POST | `/payments/bills/:id/accept` | `payment.release` | Releases the balance |
| POST | `/payments/bills/:id/query` | `payment.release` | Notifies the vendor |

Every `POST` here writes an `audit_events` row inside the same transaction (`NFR-03`) and is **idempotent on a client-supplied `Idempotency-Key` header**. A double-submitted advance is the one mistake this system must not make, and a retry on a flaky connection is how it would happen.

---

## 13 · Clients — `/clients`

Wizard: company → billing → agreement (spot/contract, number, validity, attachment) → credit and service. GSTIN checked against GSTN where present — advisory (§21).

**Rate card is read-only** — the lanes won at RFQ (`BR-37`), with rate, validity, **transit days** and **reporting rule** per lane. Spot clients show: *"Rates are set per indent with the client's written approval."*

---

## 14 · Invoicing and receivables

### 14.1 Create — `/invoices/new` · `invoice.create`

Number (series) · invoice date ● · due date (client credit days) · client ● · consignments ○ (one or many delivered unbilled trips) · freight ● · loading/unloading/detention/other ○ (**billed amounts** from charge capture) · discount ○ · round off · total · notes ○

**There are no tax fields on this screen** (`BR-15`, `D-06`, `D-26`). In their place:

```
GST PAYABLE BY RECIPIENT UNDER REVERSE CHARGE
Section 9(3), CGST Act 2017. No tax has been charged on this invoice.
```

The `invoices` table nonetheless keeps nil tax-component columns and a `tax_mechanism` defaulting to `REVERSE_CHARGE` (FSD B5). Nothing writes them today; they exist so the later forward-charge entity (`D-26`) is a configuration change rather than a migration.

`Generate invoice` consumes the number → `ISSUED`.

### 14.2 Ledger and detail

Search by number, client, phone, date. Chips: today · this week · this month · paid · pending. Ageing stack 0–30 / 31–60 / 61–90 / 90+. **No GST columns.** Invoice numbers are links.

Detail: value · received · balance · receipts. Print → **four copies** (`BR-17`). Cancel with reason; **never deleted**.

**Print layout** (FSD B6) — A4, four copies labelled shipper · consignee · POD · POD duplicate, each carrying the company block (GSTIN, PAN, CIN), the charge table across the six heads, the reverse-charge declaration above, terms, a barcode of the invoice number, and an authorised-signature block.

### 14.3 Receivables — `/receivables` · `receipt.record`

Against invoice ● · amount ● (≤ balance) · received on ● · mode ● · **UTR/cheque ●** · remarks ○

Full → `PAID`; partial → `PART_PAID`, balance stays in the ageing (`BR-16`).

---

## 15 · P&L — `/pnl`

`BR-35`, `D-05`. Granularity Daily · Monthly · Quarterly. Branch and range filters.

**Cost composition is explicit — no assumed percentage, no blanket overhead:**

```
Placement rate (to transporters)   ₹28,40,000
Loading · Unloading · Detention     ₹ 2,80,000
Other                               ₹   18,000
Total cost                         ₹31,38,000
Customer rate                      ₹36,90,000
Margin                             ₹ 5,52,000   (15.0%)
```

**Exception panel:** trips closed with no charges captured — those overstate margin and nothing else will tell you (`R-01`).

Trend chart · branch table · CSV export · A4 print.

---

## 16 · Telematics — `/telematics`

Fleet board with position, speed, fuel, last ping, e-way validity. Alerts (`BR-19`): overspeed · long halt · no signal · e-way expiring · e-way expired. Thresholds from the control panel, re-evaluated immediately on change.

Ingest: `POST /telematics/ping`, HMAC-signed provider webhook.

---

## 17 · Administration

### 17.1 Control panel — `/admin` · `config.manage`

Module toggles. Settings: KYC strict gate · **advance document set** (`BR-58`) · advance default · credit default · SLA · **POD TAT 20 · penalty ₹100/day · forfeit 40 days** · e-way warning window · overspeed · dark-vehicle interval · minimum margin % · branch catchment 150 km. Company details — name, GSTIN, PAN, CIN, address, bank — printed on every document.

**No GST rate or charge-mechanism setting exists.** FSD A6 listed one, written before `D-06`; reverse charge is permanent for this entity (`D-26`) and a configurable rate would imply otherwise.

**Numbering series** — all nine of FSD B6, each with prefix, next value, width and scope. v1.0 configured three.

| Series | Format | Scope |
|---|---|---|
| Trip | `TRP-100241` | Global |
| Lorry receipt | `LR-88215` | Global |
| Tax invoice | `NEX-INV-000001` | Global, six digits |
| Indent | `IND-30787` | Global |
| Vendor · Client · Customer | `VND-` · `CLT-` · `CUS-` | Per master |
| POD receipt | `PDR-` | **Per branch** |
| Quote · Receipt · Lead · Issue | `BID-` · `RCT-` · `LD-` · `IS-` | Global |

`NFR-08` — numbering is **gap-free and duplicate-free under concurrent use**. Issuance happens inside the transaction that creates the record, via `SELECT … FOR UPDATE` on the `number_series` row. Numbers are never pre-allocated to a draft and never reserved by a client; if the enclosing transaction rolls back, the number is not consumed. That is why generation happens at issue and not at draft — `BR-14` and `BR-13` describe the same thing from the other side. Lowering a series below a consumed value is rejected.

### 17.2 Roles matrix — `/admin/roles`

Roles down, permission groups across, three states: **None · View · Edit**. On screen:

- `payment.release` is FINANCE only and not grantable elsewhere (`BR-40`)
- `indent.create` and `document.verify` freely attachable (`D-17`, `BR-41`)
- `pod.approve` cannot be held by the same user who holds the verification on a given POD (`BR-50`)
- `config.manage` is ADMIN only
- Seed grants are §2.4
- Every change audited (`NFR-03`)

### 17.3 Approvals inbox — `/admin/approvals`

Cards: what is asked · entity link · requester · reason · age. Approve executes the original action; reject requires a note.

### 17.4 Go-live import — `/admin/import` · `config.manage`

`NFR-12`. There is no legacy system to migrate from (`D-15`), but three data sets must be loaded before the first live day, by controlled import rather than by hand — the panel alone is hundreds of vendors.

| Set | Contents | Validation |
|---|---|---|
| **Transporter panel** | Vendor master with KYC state, advance policy, bank details, fleet | Every row lands at `PENDING_VERIFICATION` at most. **Import can never set `ACTIVE`** — `BR-01` is not bypassable by CSV |
| **Client master** | Clients, agreements, credit terms, rate card lanes with validity | Rate card lanes import against a synthetic closed RFQ, so `BR-37` provenance holds and §20.3's `NOT NULL` is satisfiable |
| **Opening balances** | Outstanding advances, unbilled trips, open invoices and their ageing | Must reconcile to a control total supplied with the file; a mismatch aborts the entire import |

Each import runs upload → **dry-run report** (row count, rejects with reasons, control totals) → confirm → commit, all inside one transaction. Every imported row carries `source = 'IMPORT'` and the batch id. The import is audited as a single event with the file hash.

---

## 18 · Audit trail

`NFR-03`. Four event classes must be recorded immutably with actor and timestamp: **payment release, document verification, quote award, status change**. In practice the trail is wider. v1.0 mentioned audit twice — once as a C1 line item and once scoped to the roles matrix — which is not a specification.

```sql
audit_events (
  id            bigserial primary key,
  occurred_at   timestamptz not null default now(),
  actor_id      uuid not null,          -- never null; the system actor is a fixed uuid
  actor_role    text not null,
  event_class   text not null,          -- PAYMENT | DOC_VERIFY | QUOTE_AWARD | STATUS_CHANGE
                                        -- | CONFIG | PERMISSION | APPROVAL | IMPORT | OVERRIDE
  entity_type   text not null,
  entity_id     text not null,
  action        text not null,
  before        jsonb,
  after         jsonb,
  reason        text,                   -- mandatory for OVERRIDE, approval reject, waiver
  request_id    text not null,
  ip            inet
)
```

**Immutability is enforced in the database, not in application code.** The `internal_api` role holds `INSERT` and `SELECT` only — no `UPDATE`, no `DELETE` — and a trigger raises on either. The table is append-only and never read by business logic; reads serve the audit viewer and compliance export.

Retention follows `NFR-10`; the retention job never touches `audit_events`.

Minimum coverage, each with a test:

| Event | Written by |
|---|---|
| Advance released · balance released · bill accepted | `POST /payments/*` |
| Document verified · rejected · cross-check overridden | vendor KYC verify, trip document verify, `DOC_OVERRIDE` |
| Quote awarded, carrying the `buy_rate` written | `POST /indents/:id/award` (`BR-06`) |
| Every POD state transition | `POST /pod/:tripId/*` |
| Vendor activated · suspended · advance policy changed | vendor endpoints (`BR-57`) |
| Approval raised · approved · rejected | approvals engine |
| Role or permission changed | `/admin/roles` |
| Config changed, including the advance document set and any number series | `/admin` |
| Invoice issued · cancelled · receipt recorded | invoicing |
| Import committed, with file hash | `/admin/import` |

---

## 19 · Non-functional requirements

Spec 2's obligations under FSD B8. `NFR-02` is Spec 1's.

| Rule | How this spec meets it |
|---|---|
| `NFR-01` | Every endpoint carries `SupabaseJwtGuard` + `PermissionsGuard`. No permission check lives in the frontend alone — §2.2's "control not rendered" is presentation on top of a server rule, never instead of one |
| `NFR-03` | §18 |
| `NFR-04` | Aadhaar stored as last-4 only (`BR-04`). Identity images encrypted at rest, access restricted to `COMPLIANCE`, signed URLs at 15-minute expiry, deleted on relationship closure by a scheduled job (`R-04`) |
| `NFR-05` | **Sizing baseline: 150–200 trips a month, ≥20 concurrent internal users, 200 transporter accounts, 1.5× Feb–Jun peak** (`D-30`). Roughly 2,400 trips, 12,000 documents and 4,800 payments a year. This is a small-data system: no sharding, no read replicas, no cache layer in the first release. Indexes on `indents(stage, pickup_date)`, `trips(pod_status, delivered_at)` and `trips(branch_id, delivered_at)` carry every list screen. The architecture must not preclude an order-of-magnitude increase; the first release must not be provisioned for one |
| `NFR-06` | Desktop-first, full function on tablet, **every screen usable on a phone**. Today, POD receiving/verify and the approvals inbox are phone-*optimised* — the three used away from a desk. Tables collapse to cards below 768px; no screen requires horizontal scroll. v1.0 said "not phone-optimised", which reads as a narrower claim than `NFR-06` allows |
| `NFR-07` | Supabase daily automated backup, 30-day point-in-time recovery. A restore runbook lives at `docs/ops/restore.md` and is **exercised quarterly against a scratch project**, with the measured RTO recorded there. An untested backup is not a backup |
| `NFR-08` | §17.1 |
| `NFR-09` | **All money is `bigint` paise.** No `float`, no `numeric`, no rupee-denominated column anywhere. Rounding to the rupee happens once, at the invoice total (`invoices.round_off`) — charge lines, penalty accrual, the advance split and margin all stay exact. The API transports paise as integers; `₹` formatting is presentation. Spec 1 §3.1 already declares paise, so this is one unit across both specs |
| `NFR-10` | Invoices, receipts, LRs, PODs and audit rows retained **8 years** — GST requires 6 from the annual return, income-tax 8; the longer governs. `attachment-retention` deletes only attachments past their own `retain_until` and never a document class inside its statutory window. Identity images follow `BR-46` |
| `NFR-11` | Peak is 1.5× of a small baseline. No autoscaling needed; the requirement is met by not shipping an N+1 on the list screens. Load test at 300 trips a month before go-live |
| `NFR-12` | §17.4 |

---

## 20 · Data model

FSD B5 defines thirteen entities. This is the schema carrying them, plus the operational tables the FSD implies but does not name. Postgres, Supabase-managed. Money is `bigint` paise throughout (`NFR-09`). Spec 1 §5.2 points here for the DDL.

### 20.1 Identity and configuration

```
users               id, auth_user_id, name, email, phone, role_id, branch_id, status
roles               id, code, name, is_system
permissions         id, code                              -- payment.release, pod.verify, …
role_permissions    role_id, permission_id, level         -- NONE | VIEW | EDIT
branches            id, code, name, city, lat, lng, catchment_km default 150
config              key, value jsonb, updated_by, updated_at
number_series       key, prefix, next_value, width, scope, branch_id null
audit_events        see §18
attachments         id, kind, entity_type, entity_id, storage_path, mime, bytes,
                    uploaded_by, uploaded_at, retain_until, sha256
approvals           id, kind, entity_type, entity_id, requester_id, reason,
                    payload jsonb, status, approver_id, decided_at, note
```

`attachments.sha256` exists so a re-uploaded POD is recognisable as the same image and an import can be replayed idempotently.

### 20.2 Supply

```
vendors             id, code VND-, legal_name, party_type OWNER|VENDOR, base_city,
                    branch_id, gstin, pan, phone unique, alt_phone, fleet_base,
                    operating_states text[], advance_pct, bank_account, ifsc,
                    account_holder, status DRAFT|PENDING_VERIFICATION|ACTIVE|
                    SUSPENDED|BLACKLISTED, verified_by, panel_date, rating, source
vendor_users        user_id, vendor_id                    -- portal login link, Spec 1 §2.2
vendor_kyc          id, vendor_id, kind PAN|AADHAAR|ADDRESS|SELFIE, value_masked,
                    route API|MANUAL, status, verified_by, verified_at
                    -- BR-04: AADHAAR value_masked holds last 4 only
vendor_documents    id, vendor_id, kind TRADE_LICENCE|LABOUR_LICENCE|RC|UDYAM|
                    TDS_DECLARATION|BANK_STATEMENT, attachment_id,
                    valid_from, valid_to, status, verified_by
vendor_fleet        id, vendor_id, registration, type, capacity_tn, body_type,
                    current_city, free_from,
                    status AVAILABLE|ON_TRIP|DOCS_DUE|MAINTENANCE
vendor_advance_history  id, vendor_id, old_pct, new_pct, approval_id,
                    changed_by, changed_at          -- BR-57
leads               id, code LD-, name, city, source, party_type, trucks_claimed,
                    phone, owner_id, stage, notes
issues              id, code IS-, vendor_id, category, severity, raised_by,
                    raised_at, trip_id, status, note
market_gap_targets  id, branch_id, lane, truck_type, target, on_panel, converted
```

### 20.3 Demand and rates

```
clients             id, code CLT-, name, billing_city, gstin, contact, phone, email,
                    engagement SPOT|CONTRACT, agreement_no, valid_from, valid_to,
                    agreement_attachment_id, credit_days, service_level, status
rfqs                id, client_id, cycle_months 3|6|12, period_from, period_to,
                    due_at, reference, status DRAFT|SOURCING|QUOTED|SUBMITTED|
                    AWARDED|LOST|CLOSED, submitted_by, submitted_at
rfq_lanes           id, rfq_id, origin, destination, truck_type, transit_days,
                    reporting_rule, sourcing_mode MONTHLY|HIGH_LOW,
                    sourcing_avg, overhead, margin, quoted_rate,
                    outcome WON|LOST|WITHDRAWN, awarded_rate
                    -- BR-36: every component stored; quoted_rate derived, never keyed
rfq_lane_sourcing   id, rfq_lane_id, month date null, rate   -- monthly rows, or high + low
rate_card_lanes     id, client_id, rfq_lane_id, origin, destination, truck_type,
                    rate, transit_days, reporting_rule, valid_from, valid_to
```

`rate_card_lanes.rfq_lane_id` is **`NOT NULL`** — a rate card line with no RFQ provenance cannot exist. That is `BR-37` enforced by the schema rather than by a service, and it is why §17.4 imports client rate cards against a synthetic closed RFQ.

### 20.4 Orders

```
indents             id, code IND-, client_id, branch_id, from_city, to_city, material,
                    weight_tn, truck_type, pickup_date, transit_days, reporting_rule,
                    remarks, sell_rate, buy_rate, rate_source CONTRACT|SPOT,
                    rate_card_lane_id null, sourcing_rate null,
                    spot_confirmation_attachment_id null,
                    bid_min, bid_max, band_locked bool, advance_pct,
                    stage OPEN|VENDOR_ASSIGNED|VEHICLE_PLACED|TRIP_CREATED,
                    vendor_id null, awarded_quote_id null,
                    vehicle_no, driver_name, driver_licence, reported_at,
                    failure_cause null
quotes              id, code BID-, indent_id, vendor_id, amount, truck_registration,
                    remarks, band_position IN_BAND|ABOVE_BAND,
                    status SUBMITTED|ACCEPTED|REJECTED|WITHDRAWN, submitted_at
                    -- BR-05 / D-39: below bid_min refused at entry, never persisted
trips               id, code TRP-, indent_id, client_id, vendor_id, branch_id,
                    vehicle_no, vehicle_type, capacity_tn, driver_name, driver_licence,
                    lane, weight_tn, transit_days_required, actual_transit_days,
                    remarks, buy_rate, eway_no, eway_valid_till,
                    stage OPEN|IN_TRANSIT|DELIVERED|CLOSED, delivered_at,
                    pod_status, pod_received_at, pod_penalty, pod_closure_basis,
                    advance_paid, balance_paid, billed bool
trip_documents      id, trip_id, kind, attachment_id,
                    status PENDING|VERIFIED|REJECTED, verified_by, verified_at,
                    reject_reason, keyed_values jsonb
                    -- keyed_values feeds the BR-32 cross-check until NIC/OCR lands
trip_charges        id, trip_id, charge_type, cost_amount, billed_amount,
                    captured_by, captured_at            -- BR-45: cost and billed separate
lorry_receipts      id, code LR-, trip_id unique, lr_date, booked_at, branch_id,
                    consignor jsonb, consignee jsonb, goods jsonb, invoice jsonb,
                    eway jsonb, vehicle jsonb, driver jsonb, transit_days, remarks,
                    charges jsonb, status BOOKED|RELEASED|IN_TRANSIT|DELIVERED,
                    shared_at null                      -- BR-22: one row per trip
pod_receipts        id, code PDR-, trip_id, courier_docket, sent_on, received_on,
                    pages, received_by, condition, attachment_ids uuid[],
                    verified_by, verified_at, checklist jsonb,
                    approved_by, approved_at, reject_reason, supersedes_id null
vendor_bills        id, trip_id, vendor_id, bill_no, bill_date, attachment_id,
                    freight, charges, total, submitted_at, computed_balance,
                    variance, status SUBMITTED|ACCEPTED|QUERIED
                    -- BR-53: insert blocked unless trip.pod_status = APPROVED
payments            id, trip_id null, indent_id null, kind ADVANCE|BALANCE,
                    gross, penalty, net, mode, transfer_type, remitting_account,
                    utr, value_date, released_by, released_at,
                    idempotency_key unique
```

### 20.5 Money in

```
invoices            id, code NEX-INV-, client_id, invoice_date, due_date,
                    freight, loading, unloading, detention, other, discount,
                    round_off, total, received,
                    tax_mechanism default 'REVERSE_CHARGE',
                    taxable, cgst, sgst, igst,       -- retained, always 0 (FSD B5)
                    status DRAFT|ISSUED|PART_PAID|PAID|CANCELLED, cancel_reason
invoice_trips       invoice_id, trip_id              -- one invoice, many trips
receipts            id, code RCT-, invoice_id, client_id, amount, received_on,
                    mode, reference, remarks
telematics_pings    id, vehicle_no, at, lat, lng, speed, fuel, raw jsonb
telematics_alerts   id, vehicle_no, trip_id null, kind, raised_at, cleared_at
notifications       id, event, channel, recipient, template_id, payload jsonb,
                    status, sent_at, provider_ref
```

### 20.6 Constraints that carry business rules

Rules a database can enforce, are — so a service bug cannot bypass them:

| Rule | Enforcement |
|---|---|
| `BR-04` | `vendor_kyc.value_masked` limited to 4 chars where `kind = 'AADHAAR'` |
| `BR-09` | `payments.mode`, `transfer_type`, `remitting_account`, `utr`, `value_date` all `NOT NULL` |
| `BR-11` | `payments.net` generated as `gross − penalty` |
| `BR-22` | `lorry_receipts.trip_id` unique |
| `BR-26` | `CHECK (rate_source <> 'SPOT' OR spot_confirmation_attachment_id IS NOT NULL)` |
| `BR-37` | `rate_card_lanes.rfq_lane_id NOT NULL` |
| `BR-38` | `CHECK (rate_source <> 'SPOT' OR sell_rate > sourcing_rate)` |
| `BR-50` | `CHECK (approved_by IS NULL OR approved_by <> verified_by)` |
| `NFR-03` | No `UPDATE`/`DELETE` grant on `audit_events`; trigger raises on either |
| `NFR-09` | Every money column `bigint`; no `numeric` or `float` in the schema |

Rules needing context — `BR-01`, `BR-07`, `BR-10`, `BR-39`, `BR-40`, `BR-57`, `BR-58` — live in services, each with the e2e test §22 requires.

---

## 21 · Integrations

FSD B7 lists eight. Four were already in this spec; four were missing in v1.0 and are scoped here.

| Integration | Priority | Wave | Approach |
|---|---|---|---|
| **Document storage** | High | C1 | Supabase Storage. Signed URLs, 15-minute expiry. Nothing stores files today |
| **Messaging gateway** | Ready | C1 | DLT-registered gateway already integrated (`D-31`). Remaining work is template registration and event mapping; the event list is Spec 1 §7 |
| **KYC agency** | Medium | C2 | Manual route first (`D-08`) — compliance verifies uploaded photographs. The API sits behind `config.kyc_route` as an accelerator, never a dependency |
| **GSTN** | Low | C3 | GSTIN format and validity check on vendor and client onboarding. **Advisory only** — a failed check warns and does not block, because a small transporter may legitimately sit below the registration threshold (FSD B3.1) |
| **NIC e-way bill** | **High** | C4 | Fetch number, validity and status instead of typing them; detect extension and cancellation. Until connected, values are keyed on the trip document and `eway-expiry` works from `trips.eway_valid_till`. Connecting it replaces the keyed value with a fetched one and makes the `BR-32` vehicle-number cross-check authoritative rather than typo-prone. Read-only — Nexraah does not generate e-way bills |
| **Banking** | Medium | C6 | Two separable capabilities. **(a) UTR reconciliation** — match released payments against a bank statement feed on amount + value date + account, and flag any payment whose UTR was keyed but never appears. **(b) Payment initiation** — out of scope for the first release; finance pays by internet banking and keys the UTR (`BR-09`). Do (a) first: it catches a mis-keyed UTR, which is the failure that actually happens |
| **GPS / telematics** | High | C10 | `POST /telematics/ping`, HMAC-signed webhook. §16 |
| **Accounting system** | Medium | C7 | One-way periodic export of issued invoices, receipts and released payments as a journal file, plus a reconciliation report of whatever the accounting system rejected. Nexraah is not the books of account (FSD B1) and must not drift into becoming them |

---

## 22 · Background jobs

| Job | Schedule | Purpose |
|---|---|---|
| `pod-ageing` | 00:30 IST | Recompute penalties from `pod_received_at`; day-20 and day-40 transitions (`BR-49`, `BR-24`, `BR-25`) |
| `placement-failure` | 01:00 IST | Flag indents past pickup with a cause (`BR-18`) |
| `eway-expiry` | Hourly | Warn and expire |
| `telematics-alerts` | On ping + 15 min | `BR-19` |
| `invoice-ageing` | 02:00 IST | Overdue marking, buckets |
| `charge-capture-exception` | Weekly | Trips closed with no charges (`R-01`) |
| `forfeiture-report` | Monthly | Forfeitures by transporter (`R-02`) — a pattern is a supply problem, not a compliance win |
| `notification-dispatch` | Continuous | DLT gateway |
| `attachment-retention` | Weekly | Past `retain_until`, respecting the statutory windows of `NFR-10`. Never touches `audit_events` |
| `identity-image-purge` | Weekly | Identity images on relationships closed past their window (`BR-46`, `R-04`) |
| `bank-reconciliation` | Daily, once banking connects | Flag payments whose UTR never appears on the statement |

Single worker, distributed lock.

---

## 23 · Testing

**One e2e test per business rule.** A rule without a passing test is not done. Fifty-eight rules, `BR-01`–`BR-58`.

**Critical flows:**

1. Advance blocked → verify all eight documents of `BR-58` → releases → UTR captured
2. Advance stays blocked when fitness, permit or PUC alone is missing (`BR-58` — the three v1.0 dropped)
3. Balance blocked → POD attached → received → verified → approved → releases with penalty deducted
4. POD past 40 days → balance refused, forfeiture recorded
5. POD rejected at verification → clock resumes, `pod_received_at` cleared
6. Verifier attempts to approve their own POD → refused at the service **and** by the database constraint (`BR-50`)
7. Above-band quote accepted and flagged; award → 202 → leadership approves → award completes and writes `buy_rate` (`BR-05`, `BR-06`, `D-39`)
8. Below-band quote refused at entry and never persisted (`BR-05`)
9. Spot indent without rate approval → blocked
10. Invoice screen and printed document contain no GST anywhere
11. Non-finance role: payment button not rendered, and the endpoint returns 403
12. Branch manager sees only their branch in P&L
13. Advance policy change → 202 `ADVANCE_POLICY_CHANGE`, not applied until approved (`BR-57`)
14. Bid band cannot be widened after publication, with or without quotes (`BR-39`)
15. Concurrent LR generation issues no duplicate and leaves no gap (`NFR-08`)
16. Double-submitted advance with the same `Idempotency-Key` releases once
17. `audit_events` rejects `UPDATE` and `DELETE` (`NFR-03`)
18. Import cannot set a vendor `ACTIVE` (`NFR-12`, `BR-01`)

**Coverage gates:** 90% on `payments`, `pod`, `indents`, `identity`. 70% elsewhere.

---

## 24 · Build order

| Wave | Deliverable | Why here |
|---|---|---|
| **C1** | Auth, roles, permissions, **audit trail**, numbering, attachments, approvals engine | Everything depends on it. Audit belongs here, not retrofitted — `NFR-03` covers events every later wave emits |
| **C2** | Vendors, compliance desk | `BR-01` gates the supply side |
| **C3** | Clients, indents, quotes, award, placement | |
| **C4** | Trips, LR, documents, cross-check | |
| **C5** | **POD chain — receiving, verify, approve** | |
| **C6** | **Payments — advance, balance, penalty, forfeiture, bill matching** | C5 + C6 close both money gates |
| **C7** | Invoicing, receivables, print routes | |
| **C8** | RFQ | New, highest design risk — but not on the critical path |
| **C9** | Today, Home, P&L, exports | |
| **C10** | Telematics, notifications | |
| **C11** | Go-live import (§17.4) | Last, because it must load into a schema that has stopped moving |

**C1 also owns the schema and both DB roles** — `internal_api` full, `vendor_api` column-granted (`ADR-01`). Write them in the same migration as the tables; a grant added later is a grant that gets forgotten.

**C1 → C6 is the spine.** It delivers both money gates and roughly all the financial protection the FSD identifies as the platform's purpose. Run it on one branch in parallel with current practice before extending — a platform trusted on six screens beats one ignored on thirteen.
