# 01 · Foundation — wave C1

Session, configuration, numbering, the roles matrix, the approvals engine and attachments. Every later wave depends on all of it.

Frontend: `src/apis.ts` · `src/app/admin/apis.ts` · `src/app/admin/roles/apis.ts` · `src/app/admin/approvals/apis.ts`

---

## `GET /auth/session`

The first call every page makes. Nothing renders behind the shell until it resolves.

**Permission** — any authenticated internal principal. A principal with no internal role is rejected here, before any permission check.

**Response**

```json
{
  "userId": "u-fin",
  "name": "Rakesh Nair",
  "email": "rakesh@nexraah.in",
  "role": "FINANCE",
  "permissions": ["payment.release", "invoice.create", "receipt.record", "pnl.view_all", "indent.view"],
  "branch": null
}
```

`role` is one of `OPS · COMPLIANCE · FINANCE · BRANCH_MGR · LEADERSHIP · ADMIN`.
`branch` is `{ id, code, name }` for `BRANCH_MGR` and `null` for every other role. It is presentation only — scoping happens at the repository layer regardless.

`permissions` is the authoritative grant list. The frontend hides controls from it; the server enforces the same list on every request.

---

## `GET /branches`

**Response** — `[{ "id": "br-nsk", "code": "NSK", "name": "Nashik", "city": "Nashik", "catchmentKm": 150 }]`

---

## `GET /config` · `PATCH /config`

**Permission** — `GET` any internal role; `PATCH` `config.manage`.

**Response / PATCH body** (partial patches accepted)

```json
{
  "modules": { "rfq": true, "telematics": true, "invoicing": true, "import": true },
  "kyc_strict_gate": true,
  "kyc_route": "MANUAL",
  "advance_document_set": ["CLIENT_INVOICE_OR_PO","EWAY_BILL","RC","INSURANCE","FITNESS","PERMIT","PUC","DRIVING_LICENCE"],
  "advance_default_pct": 40,
  "credit_default_days": 45,
  "sla_hours": 24,
  "pod_tat_days": 20,
  "pod_penalty_per_day_paise": 10000,
  "pod_forfeit_days": 40,
  "eway_warning_window_hours": 12,
  "overspeed_kmph": 80,
  "halt_minutes": 90,
  "dark_vehicle_interval_minutes": 120,
  "minimum_margin_pct": 8,
  "branch_catchment_km": 150,
  "company": {
    "name": "Nexraah Logistics Private Limited",
    "gstin": "27AABCN4471K1ZV",
    "pan": "AABCN4471K",
    "cin": "U63030MH2019PTC332211",
    "address": "Plot 44, MIDC Ambad, Nashik 422010, Maharashtra",
    "bank": "HDFC Bank · Nashik · A/c 50200044714471 · IFSC HDFC0000188"
  }
}
```

**Rules.** `advance_document_set` is read by the advance gate (`BR-58`); removing a member releases money that was previously held, so the change writes a `CONFIG` audit row. There is deliberately **no GST rate or charge-mechanism setting** — reverse charge is permanent for this entity (`D-26`), and a configurable rate would imply otherwise.

`company` is printed on every lorry receipt, invoice and P&L statement.

---

## `GET /config/number-series` · `PATCH /config/number-series/:key`

**Permission** — `config.manage` to patch.

**Response** — all nine of FSD B6:

```json
[{ "key": "TRIP", "prefix": "TRP-", "nextValue": 120882, "width": 6, "scope": "GLOBAL", "branchId": null }]
```

`key` ∈ `TRIP · LR · INVOICE · INDENT · VENDOR · CLIENT · CUSTOMER · POD_RECEIPT · QUOTE · RECEIPT · LEAD · ISSUE`.
`scope` ∈ `GLOBAL · BRANCH · MASTER`. `POD_RECEIPT` is **per branch**.

**Errors** — `409 SERIES_LOWERED` when `nextValue` is below a consumed value.

**Rules.** `NFR-08` — issuance happens inside the transaction that creates the record, via `SELECT … FOR UPDATE` on the series row. Numbers are never pre-allocated to a draft and never reserved by a client; a rolled-back transaction does not consume one.

---

## `GET /admin/roles` · `PATCH /admin/roles/:role/permissions`

**Permission** — `config.manage` to patch.

**GET response**

```json
{
  "roles": ["OPS","COMPLIANCE","FINANCE","BRANCH_MGR","LEADERSHIP","ADMIN"],
  "grants": { "OPS": ["indent.manage","indent.view","vendor.edit","rfq.edit"] },
  "matrix": { "OPS": { "pod.verify": "EDIT" } }
}
```

`grants` is the seed (part 01 §2.4); `matrix` is the overrides applied since. The frontend composes the two — an override of `NONE` removes a seeded grant.

**PATCH body** — `{ "permission": "pod.verify", "level": "EDIT" }`, `level` ∈ `NONE · VIEW · EDIT`.

**Errors** — `409 PERMISSION_FIXED` for the four fixed permissions: `payment.release` (FINANCE only, `BR-40`), `pod.waive` (`BR-43`), `rfq.submit`, `config.manage`. **`payment.release` cannot be granted to a second role by anybody, including an administrator.**

Every accepted change writes a `PERMISSION` audit row.

---

## `GET /approvals`

**Query** — `status` (default `PENDING`), `kind`.

**Response**

```json
[{
  "id": "apr-1",
  "kind": "ABOVE_BAND_PRICE",
  "entityType": "indent",
  "entityId": "IND-4468",
  "title": "Award at ₹35,800 · band ceiling ₹33,000",
  "detail": "Chakan → Coimbatore. Only two quotes in band…",
  "amountPaise": 3580000,
  "requesterId": "u-bm",
  "requesterName": "Sunita Rao · BRANCH_MGR",
  "approverRole": "LEADERSHIP",
  "requiredPermission": "approve.above_band",
  "reason": "Only above-band quotes on this lane for three consecutive loads.",
  "status": "PENDING",
  "createdAt": "2026-08-10T09:40:00.000Z"
}]
```

`title` and `detail` are server-composed strings the inbox renders verbatim; the frontend does not reconstruct them from the entity. `amountPaise` is `null` where the request has no money in it.

**The sidebar badge** counts rows whose `requiredPermission` the signed-in user holds. Getting that field wrong silently mis-routes work.

---

## `POST /approvals/:id/approve`

Executes the original action with the **stored payload, replayed verbatim**. Returns the updated approval.

**Errors** — `409` with the reason when replay is no longer valid (vendor suspended, indent cancelled). Fails closed.

## `POST /approvals/:id/reject`

**Body** — `{ "note": "…" }`. The note is **mandatory**; `400` without it. The requester is notified.

---

## `POST /attachments`

`multipart/form-data`, field `file`. Optional metadata fields: `kind`, `entityType`, `entityId`.

**Response** — `{ "id": "att-1723…", "sha256": "e3b0c442…", "uploadedAt": "…" }`

`sha256` exists so a re-uploaded POD is recognisable as the same image and an import can be replayed idempotently.

## `GET /attachments/:id/url`

**Response** — `{ "url": "https://…", "expiresAt": "…" }` · **15-minute** expiry.

Identity images are encrypted at rest and restricted to `COMPLIANCE` (`NFR-04`, `R-04`).

---

## Done when

- [ ] A user with no internal role is rejected by `PermissionsGuard` before any permission check
- [ ] `payment.release` cannot be granted to a second role, by any caller
- [ ] All six approval kinds return `202`, replay verbatim on approve, and fail closed on a stale payload
- [ ] Concurrent issue of any series produces no duplicate and no gap
- [ ] `audit_events` rejects `UPDATE` and `DELETE` at the database
- [ ] `config.advance_document_set` is seeded with all eight documents of `BR-58`
