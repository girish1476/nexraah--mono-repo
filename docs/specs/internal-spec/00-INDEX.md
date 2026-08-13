# Internal Console — build parts

**Source:** `docs/specs/SPEC-2-internal-console-fullstack.md` v1.1, split into buildable parts.
**Authority:** `docs/FSD/Nexraah-FSD-v2.2.md`. Every `BR-`, `NFR-`, `D-`, `R-`, `ACT-`, `MOD-` identifier resolves there.
**Companion:** `docs/specs/SPEC-1-vendor-portal-fullstack_1.md` — the transporter portal, a separate frontend.
**Architecture:** [`docs/adr/ADR-02-internal-owns-operations.md`](../../adr/ADR-02-internal-owns-operations.md). `internal-api` owns every operation and also serves `/api/v1/portal/*`; `vendor-api` is a proxy with no database credentials. `ADR-01` — a second backend for the vendor side — is superseded. Read the ADR before part 01.

These parts are canonical for building. `SPEC-2-internal-console-fullstack.md` remains the single-file narrative and is not edited further — if the two disagree, a part file wins and the whole-file version is stale.

---

## The parts

| Part | Wave | Covers | Depends on |
|---|---|---|---|
| [01 · Foundation](01-C1-foundation.md) | **C1** | Architecture, roles, permissions, guards, approvals engine, numbering, attachments, audit trail, control panel, roles matrix, approvals inbox | — |
| [02 · Data model](02-data-model.md) | **C1** | Full schema, both DB roles, constraints that carry rules | 01 |
| [14 · Supabase & DB setup](14-supabase-setup.md) | **C1** | Migrations, DDL conventions, the two pools, Auth, Storage, pooling mode, RLS decision, env contract, seeding, backup | 02 |
| [03 · Vendors & compliance](03-C2-vendors-compliance.md) | **C2** | Onboarding wizard, vendor search and detail, leads, market gap, issues, compliance desk | 01, 02 |
| [04 · Clients & indents](04-C3-clients-indents.md) | **C3** | Client master, rate cards, indent raise, quotes, award, placement | 03 |
| [05 · Trips & lorry receipt](05-C4-trips-lr.md) | **C4** | Trip search and detail, eleven documents, cross-check, charge capture, LR and print | 04 |
| [06 · Proof of delivery](06-C5-pod.md) | **C5** | Five-state chain, receiving register, verify, approve, chase list, waiver | 05 |
| [07 · Payments](07-C6-payments.md) | **C6** | Advance gate, balance gate, penalty, forfeiture, transporter bill matching | 06 |
| [08 · Invoicing & receivables](08-C7-invoicing.md) | **C7** | Invoice builder, ledger, receipts, ageing, four-copy print | 05 |
| [09 · RFQ & rate management](09-C8-rfq.md) | **C8** | RFQ lifecycle, sourcing rates, quote build-up, award, rate card creation | 04 |
| [10 · Reporting](10-C9-reporting.md) | **C9** | Today, Home, P&L, exports | 07 |
| [11 · Telematics & notifications](11-C10-telematics-notifications.md) | **C10** | Fleet board, alerts, ping ingest, notification dispatch | 05 |
| [12 · Go-live import](12-C11-go-live-import.md) | **C11** | Transporter panel, client master, opening balances | all |
| [13 · Cross-cutting](13-cross-cutting.md) | all | NFR obligations, integrations, background jobs, testing | — |

Part 14 sits out of numeric order because it was written after `ADR-02`. **Build order within `C1` is 01 → 02 → 14**; nothing can be built until a database exists.

**C1 → C6 is the spine.** Both money gates and roughly all the financial protection the FSD names as the platform's purpose. Run it on one branch in parallel with current practice before extending.

---

## Rule coverage

Every rule in FSD B4 and B8 has an owning part. `MOD-PRT` rules belong to Spec 1 and are marked so.

### Business rules `BR-01`–`BR-58`

| Rule | Subject | Owner |
|---|---|---|
| `BR-01` | Uncleared vendor never assignable | 03 · 04 |
| `BR-02` | RC mandatory for Owner | 03 |
| `BR-03` | TDS declaration mandatory, every party type | 03 |
| `BR-04` | Aadhaar last four only | 03 · 02 |
| `BR-05` | Below-band refused, above-band flagged (`D-39`) | 04 · Spec 1 |
| `BR-06` | Award writes `buy_rate` | 04 |
| `BR-07` | Advance gated on verified documents | 07 |
| `BR-08` | Advance amount locked | 07 |
| `BR-09` | Payment records mode · transfer type · account · UTR · value date | 07 · 02 |
| `BR-10` | Balance gated on POD approved | 07 |
| `BR-11` | Balance = billable − advance | 07 · 02 |
| `BR-12` | POD breached past 20 days | 06 |
| `BR-13` | LR only after placement | 05 |
| `BR-14` | Numbers from a series, consumed on issue | 01 |
| `BR-15` | Reverse charge only, no GST | 08 |
| `BR-16` | Full receipt closes, partial part-pays | 08 |
| `BR-17` | Invoice prints four copies | 08 |
| `BR-18` | Placement failure recorded with a cause | 10 · 13 |
| `BR-19` | Telematics alerts | 11 |
| `BR-20` | Branch derived from pickup, carried unchanged | 04 |
| `BR-21` | Trip number per order | 04 |
| `BR-22` | LR and E-LR one record, sharing optional | 05 · 02 |
| `BR-23` | PAN and Aadhaar card photographs | 03 |
| `BR-24` | ₹100/day from day 21 | 06 · 07 |
| `BR-25` | Past 40 days, nothing payable | 06 · 07 |
| `BR-26` | Spot rate confirmation attached | 04 · 02 |
| `BR-27` | Transit days captured and measured | 04 · 05 |
| `BR-28` | Remarks carried through | 04 · 05 |
| `BR-29` | None/View/Edit per role, server-side | 01 |
| `BR-30` | Advance % defaults from vendor policy | 04 |
| `BR-31` | Identity verified once, route recorded | 03 |
| `BR-32` | Three-document cross-check | 05 |
| `BR-33` | No TDS deducted this release | 07 |
| `BR-34` | 150 km branch catchment | 03 |
| `BR-35` | P&L cost = placement rate + every charge | 10 |
| `BR-36` | Quote build-up components stored | 09 · 02 |
| `BR-37` | Won lane becomes the rate card | 09 · 02 |
| `BR-38` | Spot never quoted below sourcing | 04 · 02 |
| `BR-39` | Band never widened | 04 |
| `BR-40` | Finance-only payment; above-band and exceptions approved | 01 · 07 |
| `BR-41` | `indent.create` and `document.verify` grantable | 01 |
| `BR-42` | Late reporting is a transit delay | 04 |
| `BR-43` | Waiver: compliance proposes, leadership approves | 06 |
| `BR-44` | Failed cross-check rejected; override needs a reason | 05 |
| `BR-45` | Charge cost and billed value held separately | 05 |
| `BR-46` | Identity images retained for the relationship | 03 · 13 |
| `BR-47` | Multi-branch decided by client operating location | 03 |
| `BR-48` | POD five states plus Forfeited | 06 |
| `BR-49` | Clock stops at branch receipt | 06 |
| `BR-50` | Approver ≠ verifier | 06 · 02 |
| `BR-51` | POD attach needs docket and sent-on | Spec 1 · 06 |
| `BR-52` | Rejection does not stop the clock | 06 |
| `BR-53` | Bill only after approval, variance flagged | 07 · 02 |
| `BR-54` | LR visible to transporter, redacted | Spec 1 |
| `BR-55` | Redaction by construction | Spec 1 |
| `BR-56` | Charges captured at verification | 06 · 05 |
| `BR-57` | Advance-policy change needs approval | 01 · 03 · 04 |
| `BR-58` | Eight-document advance set, configurable | 01 · 05 · 07 |

### Non-functional `NFR-01`–`NFR-12`

| Rule | Owner |
|---|---|
| `NFR-01` server-side access control | 01 |
| `NFR-02` transporter isolation | Spec 1 |
| `NFR-03` immutable audit trail | 01 |
| `NFR-04` Aadhaar and identity retention | 03 · 13 |
| `NFR-05` sizing baseline | 13 |
| `NFR-06` tablet and phone | 13 |
| `NFR-07` backup and tested restore | 13 |
| `NFR-08` gap-free numbering under concurrency | 01 |
| `NFR-09` integer paise | 02 |
| `NFR-10` statutory retention | 13 |
| `NFR-11` peak load | 13 |
| `NFR-12` go-live import | 12 |

---

## Conventions every part follows

**Money** is `bigint` paise everywhere — API, database, computation. Rupee rounding happens once, at the invoice total. No `float`, no `numeric` (`NFR-09`).

**Permissions** are checked server-side on every request with `@UseGuards(SupabaseJwtGuard, PermissionsGuard)` and `@RequirePermission(...)`. A control hidden in the frontend is presentation on top of a server rule, never instead of one (`NFR-01`).

**Blocked states** state what is missing by name and what would unblock it. `🔒 Advance blocked — E-way bill uploaded but not verified · Driving licence not uploaded` beats any success state.

**Approvals** return `202 APPROVAL_REQUIRED`, which is not an error. The originating control becomes `Awaiting approval` and stays disabled.

**Every mutation** writes an `audit_events` row inside the same transaction (`NFR-03`).

**Every part ships its tests.** A rule without a passing e2e test is not done (`§23`, part 13).

---

## Repo layout these parts build into

```
apps/internal-portal/src/app/<route>/   page.tsx · apis.ts · types.ts
apps/internal-api/src/<module>/         controller · service · dto · repository
packages/*                              shared types and enums only, no runtime
```

Frontend convention is the root `README.md`: root axios instance in `src/apis.ts`, jotai atoms in `src/store/`, page-scoped `apis.ts` and `types.ts`.
