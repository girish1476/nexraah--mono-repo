# Part 01 · Foundation — wave C1

| | |
|---|---|
| **Wave** | C1 — everything depends on it |
| **Depends on** | Nothing |
| **Rules owned** | `BR-14`, `BR-29`, `BR-40`, `BR-41`, `BR-57` (engine half), `BR-58` (config half), `NFR-01`, `NFR-03`, `NFR-08` |
| **Screens** | `/admin`, `/admin/roles`, `/admin/approvals` |
| **Also delivers** | Auth, permissions, attachments, numbering, the approvals engine and the audit trail — consumed by every later wave |

> Audit belongs in this wave, not retrofitted. `NFR-03` covers events every later wave emits; a trail added at C7 has no record of C2 through C6.

---

## 1 · Architecture

```
internal-portal      Next.js 14 · port 3002
   │  jotai · axios · react-hook-form + zod
   ▼
internal-api         NestJS · port 4002 · /api/v1/*
   │  PermissionsGuard · business rules · audit
   ▼  internal_api DB role — full schema access
Supabase  Postgres · Auth · Storage
```

**Four processes, one backend** (`ADR-02`). `internal-portal` and `vendor-portal` are separate applications — separate deployables, no shared layout, no shared component, no `if (isTransporter)` anywhere. `internal-api` is the only process that touches the database; `vendor-api` is a proxy for `/api/v1/portal/*` with no database credentials.

This spec owns **both** Postgres roles and the two pools that bind them:

| Pool | Role | Serves |
|---|---|---|
| `internalPool` | `internal_api` — full schema access | `/api/v1/*` |
| `portalPool` | `vendor_api` — column-level grants only | `/api/v1/portal/*`, provided by `PortalModule` |

Adding a column a transporter must never see requires no change to the portal handlers, because the grant is never issued and the query raises. That is the whole of redaction layer one — see `../vendor-specs/02-redaction-contract.md` §3 and `../../adr/ADR-02-internal-owns-operations.md` §3. Session-mode pooling is mandatory; see part 14 §5.

| Layer | Choice |
|---|---|
| Web | `apps/internal-portal` — Next.js 14, App Router, port 3002 |
| State | jotai atoms in `src/store/`; axios instance in `src/apis.ts`; per-page `apis.ts` + `types.ts` |
| Forms | react-hook-form + zod — install here, first used by the C2 wizard |
| API | `apps/internal-api` — NestJS, port 4002, global prefix `/api/v1` |
| Shared code | `packages/*` — types and enums only. Create the first package when a second consumer needs a symbol |

### 1.1 Route structure

Paths are under `apps/internal-portal/src/app/`. There is no `(app)` route group — the whole application is the internal console, so a group segment buys nothing.

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

Full visibility matrix: **FSD B2**, reissued in v2.2 with the `ADMIN` column and the five module rows v2.1 omitted.

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

`BR-29` puts None/View/Edit on every module for every role. Beyond that matrix, these named permissions seed as follows. FSD B2 assigns the POD three to *branch or compliance*.

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

`ADVANCE_POLICY_CHANGE` covers both cases `D-22` names: compliance changing the standing percentage on a vendor file, and a desk overriding it on one urgent indent. Reason mandatory, ≥ 20 characters.

**Frontend:** the originating control becomes `Awaiting approval` and stays disabled. An amber banner names what was asked and who must approve. No success toast.

**On approval** the original action executes with the original payload. On rejection a note is mandatory and the requester is notified.

```
GET  /approvals?status=pending&kind=
POST /approvals/:id/approve
POST /approvals/:id/reject      { note }   note required
```

The stored payload is replayed **verbatim** on approval, never recomputed — a rate that moved in the interim must not silently change what leadership agreed to. If replay is no longer valid (vendor suspended, indent cancelled) the approval fails closed with `409` and the reason.

---

## 4 · Control panel — `/admin` · `config.manage`

Module toggles. Settings: KYC strict gate · **advance document set** (`BR-58`) · advance default · credit default · SLA · **POD TAT 20 · penalty ₹100/day · forfeit 40 days** · e-way warning window · overspeed · dark-vehicle interval · minimum margin % · branch catchment 150 km. Company details — name, GSTIN, PAN, CIN, address, bank — printed on every document.

**No GST rate or charge-mechanism setting exists.** FSD A6 listed one, written before `D-06`; reverse charge is permanent for this entity (`D-26`) and a configurable rate would imply otherwise.

### 4.1 Numbering series

All nine of FSD B6, each with prefix, next value, width and scope.

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

### 4.2 Advance document set — `config.advance_document_set`

Seeded with the eight of `BR-58`: `CLIENT_INVOICE_OR_PO`, `EWAY_BILL`, `RC`, `INSURANCE`, `FITNESS`, `PERMIT`, `PUC`, `DRIVING_LICENCE`. Removing one is an audited configuration change (`NFR-03`). Read by part 07 at the advance gate and rendered by part 05 on the documents tab.

---

## 5 · Roles matrix — `/admin/roles`

Roles down, permission groups across, three states: **None · View · Edit**. On screen:

- `payment.release` is FINANCE only and not grantable elsewhere (`BR-40`)
- `indent.create` and `document.verify` freely attachable (`D-17`, `BR-41`)
- `pod.approve` cannot be held by the same user who holds the verification on a given POD (`BR-50`)
- `config.manage` is ADMIN only
- Seed grants are §2.4
- Every change audited (`NFR-03`)

---

## 6 · Approvals inbox — `/admin/approvals`

Cards: what is asked · entity link · requester · reason · age. Approve executes the original action; reject requires a note.

---

## 7 · Attachments

```
POST   /attachments                 multipart, returns { id, sha256 }
GET    /attachments/:id/url         signed URL, 15-minute expiry
```

Supabase Storage. Every row carries `retain_until`, `sha256` and the uploading actor. `sha256` exists so a re-uploaded POD is recognisable as the same image and an import can be replayed idempotently. Identity images are encrypted at rest with access restricted to `COMPLIANCE` (`NFR-04`, `R-04`).

---

## 8 · Audit trail

`NFR-03`. Four event classes must be recorded immutably with actor and timestamp: **payment release, document verification, quote award, status change**. In practice the trail is wider.

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

### 8.1 Minimum coverage

| Event | Written by | Part |
|---|---|---|
| Advance released · balance released · bill accepted | `POST /payments/*` | 07 |
| Document verified · rejected · cross-check overridden | vendor KYC verify, trip document verify, `DOC_OVERRIDE` | 03 · 05 |
| Quote awarded, carrying the `buy_rate` written | `POST /indents/:id/award` (`BR-06`) | 04 |
| Every POD state transition | `POST /pod/:tripId/*` | 06 |
| Vendor activated · suspended · advance policy changed | vendor endpoints (`BR-57`) | 03 |
| Approval raised · approved · rejected | approvals engine | 01 |
| Role or permission changed | `/admin/roles` | 01 |
| Config changed, including the advance document set and any number series | `/admin` | 01 |
| Invoice issued · cancelled · receipt recorded | invoicing | 08 |
| Import committed, with file hash | `/admin/import` | 12 |

---

## 9 · Done when

- [ ] A user with no internal role is rejected by `PermissionsGuard` before any permission check
- [ ] Every seed grant in §2.4 exists and `payment.release` cannot be granted to a second role
- [ ] All six approval kinds raise `202`, replay verbatim on approve, and fail closed on stale payload
- [ ] All nine number series configured; concurrent issue produces no duplicate and no gap (`NFR-08`)
- [ ] `audit_events` rejects `UPDATE` and `DELETE` at the database, proven by test
- [ ] Attachments store, return signed URLs at 15-minute expiry, and record `sha256` and `retain_until`
- [ ] `config.advance_document_set` seeded with all eight documents of `BR-58`

**Tests** (part 13 §23): 11, 15, 16, 17.
