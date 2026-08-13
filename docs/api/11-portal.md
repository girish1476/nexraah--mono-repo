# 11 · Transporter portal — `/api/v1/portal/*`

**Audience:** transporters, external. **Served by:** `internal-api`. **Reached through:** `vendor-api` (`ADR-02`).

No internal screen calls anything in this file. Everything here is the build target for `apps/internal-api/src/portal/*`, consumed by `vendor-portal` via the proxy.

`00-conventions.md` applies in full — envelope, money in paise, ISO dates, `SCREAMING_SNAKE_CASE` enums, `202` approvals — **except** where §2 and §4 below say otherwise. Redaction rules and DTO field lists are owned by `docs/specs/vendor-specs/02-redaction-contract.md` and are not restated here; this file is the wire contract.

---

## 1 · Transport and provenance

```
vendor-portal ──▶ http://localhost:4001/api/v1/portal/*     (vendor-api, the edge)
                        │  forwards, unmodified body and Authorization header
                        │  adds  X-Portal-Service: <PORTAL_SERVICE_KEY>
                        │  adds  X-Request-Id      (generated if absent)
                  ──▶ http://localhost:4002/api/v1/portal/*  (internal-api, the handlers)
```

`vendor-portal` sets `NEXT_PUBLIC_API_BASE_URL=http://localhost:4001/api/v1`. It never addresses port 4002.

**Two credentials, two questions.** `Authorization: Bearer <supabase jwt>` answers *who is this*; `X-Portal-Service` answers *did this arrive through the vendor edge*. Both are required on every route in this file except `POST /portal/auth/login`, which needs only the service key.

`vendorId` is resolved by `internal-api` from `vendor_users` against the JWT subject. **No header names the vendor.** `vendor-api` sets no `X-Vendor-Id` and `internal-api` would ignore one — a proxy that could name the vendor could impersonate one.

The lock runs both ways: `/portal/*` without a valid service key is `403 SERVICE_KEY_REQUIRED`; any non-portal `/api/v1/*` route **with** one is `403 WRONG_AUDIENCE`.

Every handler in this file runs on `portalPool`, authenticated as `vendor_api`. A query touching `indents.client_id` or `indents.sell_rate` raises at the database. That is layer one of the redaction contract and it is not optional.

### 1.1 Timeouts and retries at the edge

| | |
|---|---|
| Proxy timeout | 30s for `multipart/form-data`, 10s otherwise. On expiry return `504 UPSTREAM_TIMEOUT` |
| Retry | **`GET` and `HEAD` only** — two attempts, 250ms backoff. Never retry a `POST`, `PATCH` or `DELETE`; that is what the idempotency key in §3 is for |
| Multipart | Streamed through, not buffered. The edge holds no file bytes on disk |
| `X-Request-Id` | Generated at the edge if absent, logged by both processes on every line, returned on every response including errors |

---

## 2 · Errors

The envelope and shape are `00-conventions.md` §3. The **vocabulary is the transporter's**, from `vendor-specs/11-cross-cutting.md` §2:

| Code | Status | Meaning |
|---|---|---|
| `SERVICE_KEY_REQUIRED` | 403 | Reached `/portal/*` without the edge's key |
| `WRONG_AUDIENCE` | 403 | An internal principal hit `/portal/*` |
| `VENDOR_SUSPENDED` | 403 | Reads allowed, writes refused (`vendor-specs/01-P1` §2.3) |
| `BELOW_BAND` | 422 | Quote below `bidMin`; `details.bidMin` carries the floor |
| `QUOTE_EXISTS` | 409 | Already quoted on this load; the screen offers withdraw |
| `POD_NOT_APPROVED` | 409 | Bill submitted before POD approval (`BR-53`) |
| `UPSTREAM_TIMEOUT` | 504 | The edge gave up on `internal-api` |
| — | **404** | Another vendor's record. **Never 403** |

> **An internal error code must never reach a transporter.** `ADVANCE_BLOCKED` with its `details.unmet` array, `VENDOR_INCOMPLETE`, `SERIES_LOWERED` and the rest of `00-conventions.md` §3 are internal vocabulary; several carry field names a transporter has no business learning. Portal handlers **map before throwing** — they do not let an internal service's exception propagate. An unmapped code escaping to `/portal/*` is a `BR-55` finding, not a cosmetic one. The mapping lives in the portal module and is asserted by test: every exception type the portal path can raise has a portal code, or the test fails.

The proxy does not translate. It passes bodies through byte-for-byte — it has no database access and could not tell a safe field from a leaking one.

**404, never 403, for another vendor's record.** A 403 confirms existence; vendor A probing an id range learns how many trips vendor B is running.

---

## 3 · Idempotency — required on every portal write

```
Idempotency-Key: <uuid>
```

`00-conventions.md` §8 requires this on two payment endpoints. **Every write in this file requires it too**, and for a better reason: these are phone-on-4G submissions. A transporter on a truck stop's signal taps *Submit bill*, the response is lost, they tap again. Without a key that is two bills.

| Endpoint | Repeat with the same key returns |
|---|---|
| `POST /portal/loads/:code/quote` | the original quote, `200` |
| `DELETE /portal/quotes/:id` | `200`, already withdrawn |
| `POST /portal/fleet` | the original vehicle, `200` |
| `PATCH /portal/fleet/:id` | the current row, `200` |
| `POST /portal/trips/:id/pod` | the original receipt, `200` |
| `POST /portal/trips/:id/bill` | the original bill, `200` |
| `POST /portal/profile/documents/:kind` | the original document, `200` |

Scope: `(vendor_id, endpoint, idempotency_key)`, unique-constrained. Never a global key space — one vendor must not be able to probe another's keys. Missing key on a write → `400 IDEMPOTENCY_KEY_REQUIRED`. `vendor-portal` mints one key per attempt, reuses it across retries, and mints fresh only after a success.

---

## 4 · File upload — the transporter sends multipart

`00-conventions.md` §10 says *"No domain endpoint accepts a file body."* **That rule is internal-only and does not extend to `/portal/*`.**

Three portal endpoints accept `multipart/form-data` directly: POD, vendor bill, KYC document. A two-step upload-then-reference costs a transporter two round trips on a phone connection, and the failure mode — an orphan attachment with no domain row — is the one they cannot recover from themselves.

**The upload-then-reference pattern is preserved server-side.** The portal handler writes the `attachments` row first, then the domain row, in one transaction. The transporter never sees an attachment id and never sends one.

```
POST /portal/trips/:id/pod           multipart: file, docketNo, sentOn
  → internal-api streams the part to Supabase Storage
  → computes sha256 SERVER-SIDE, sets retain_until, records the actor
  → INSERT attachments, INSERT pod_receipts — one transaction
  → { podId, status: "ATTACHED", ... }
```

| Rule | |
|---|---|
| `sha256` | Computed by `internal-api` from the received bytes. **Never accepted from the client.** A client-supplied hash is a client-supplied claim |
| `retain_until` | Set server-side from policy. Not a request field |
| Size | **Enforced server-side at 10MB**, `413 FILE_TOO_LARGE`. `FE.md` §224 checks this client-side too; the client check is courtesy, the server check is the control |
| MIME | Allow-list `image/jpeg`, `image/png`, `application/pdf`, sniffed from content, not trusted from the header. Anything else → `415 UNSUPPORTED_FILE_TYPE` |
| Signed URLs | 15 minutes, `00-conventions.md` §10 unchanged |
| Identity images | Encrypted at rest, `COMPLIANCE`-only access (`NFR-04`) |

---

## 5 · Endpoints

Permission is `portal.self` unless named otherwise. **Every response is scoped `WHERE vendor_id = ctx.vendorId` at the repository layer** — not restated per row below.

### 5.1 Session

| | |
|---|---|
| `POST /portal/auth/login` | `{ email, password }` → `{ token, expiresAt }`. Service key only, no bearer. 10 per 15 min per account. **No registration endpoint exists anywhere** — accounts come from `POST /vendors/:id/activate` (`02-vendors-compliance.md`), which is `BR-01` reaching the login screen |
| `GET /portal/me` | `{ vendorId, legalName, code, status, permissions }`. `status` drives the suspension banner |

### 5.2 Loads and quotes — part `P2`

| | |
|---|---|
| `GET /portal/loads?truckType=&branch=` | `PortalLoadDTO[]`. `BR-55`. 120/hour, log outliers. **Not** `GET /indents` with fields removed — a separate handler, a separate DTO, a separate pool. Filtered to open indents the vendor may bid, minus any awarded elsewhere |
| `GET /portal/loads/:code` | One `PortalLoadDTO`. `code` is the `IND-` series, never `LD-` |
| `POST /portal/loads/:code/quote` | `{ amountPaise, vehicleId?, remarks? }` → the created quote. `BR-05` band check against `bidMin`/`bidMax`, **the same band service the RFQ award path calls**. Below band → `422 BELOW_BAND` with `details.bidMin`, nothing persisted. Above band → `202` approval (`D-39`, `00-conventions.md` §7). Existing quote → `409 QUOTE_EXISTS`. A `DOCS_DUE` vehicle cannot be offered. 30/hour |
| `GET /portal/quotes?status=` | Their quotes only. A rejected quote carries **no reason and no winning amount**, ever |
| `DELETE /portal/quotes/:id` | Withdraw. Only while `SUBMITTED`; otherwise `409` |

**A load awarded to someone else disappears from the list.** It does not appear as lost, outbid, or filled. `vendor-specs/02-redaction-contract.md` §5 — copy is part of the contract.

### 5.3 Fleet — part `P3`

| | |
|---|---|
| `GET /portal/fleet` | Their vehicles with document states |
| `POST /portal/fleet` | Add a vehicle |
| `PATCH /portal/fleet/:id` | Update. **`DOCS_DUE` is not caller-settable** — it is derived from document verification state. A request naming it is rejected, not ignored |

### 5.4 Trips, LR, POD — parts `P4`, `P5`

| | |
|---|---|
| `GET /portal/trips?status=` | Redacted trip list. Carries `advanceBlockers`, `penaltyPaise`, `netPayablePaise`, `podDaysElapsed` (`FE.md` §142-176) |
| `GET /portal/trips/:id` | One trip, same shape |
| `GET /portal/trips/:id/lorry-receipt` | `PortalLorryReceiptDTO`. `BR-54`, `D-36`. `pdfUrl` is a **signed 15-minute URL to a server-rendered document**, not a client render of the DTO — the paper LR legally names consignor and consignee, and the DTO must not |
| `POST /portal/trips/:id/pod` | Permission `pod.upload`. Multipart per §4: `file`, `docketNo`, `sentOn`. `BR-51` — both fields required. Sets `ATTACHED`; `docs/api/05-pod.md` picks the lifecycle up at `RECEIVED`. **Attaching does not stop the penalty clock** (`BR-49`) and the response must not imply it did |

### 5.5 Vendor bill — part `P6`

| | |
|---|---|
| `GET /portal/trips/:id/bill` | Submittability checklist + the four-line balance breakdown. No internal equivalent exists; this is a portal-only shape (`FE.md` §235) |
| `POST /portal/trips/:id/bill` | Permission `portal.bill`. Multipart per §4. `BR-53` — POD must be approved, else `409 POD_NOT_APPROVED`. A bill **above** the computed balance is **flagged for the desk, not rejected** — the transporter is often right, and refusing it silently starts a phone call the branch has no record of |

### 5.6 Profile and KYC — part `P7`

| | |
|---|---|
| `GET /portal/profile` | **Masked.** PAN and bank account last four only. Not `GET /vendors/:id` with fields dropped |
| `POST /portal/profile/documents/:kind` | Multipart per §4, plus `lat`/`lng` geotag on identity kinds (`FE.md` §358-363). `BR-23`. **Extends** the existing `POST /vendors/:id/documents/:kind` service with a portal permission — the internal route is `COMPLIANCE`-permissioned and a transporter must not hold that |

---

## 6 · Done when

- [ ] All 18 routes served by `internal-api` under `PortalModule`, bound to `portalPool`
- [ ] `vendor-api` proxies `/api/v1/portal/*` and returns 404 for every other path
- [ ] Every write requires `Idempotency-Key`; a replay returns the original row and `200`
- [ ] `sha256` is computed server-side on all three multipart endpoints; a client-supplied value is ignored
- [ ] Server-side size and sniffed-MIME limits enforced, with `413` and `415`
- [ ] Every exception reachable from a portal handler has a portal error code — asserted by test
- [ ] `X-Request-Id` appears in both processes' logs and on every response
- [ ] The nine isolation assertions of `vendor-specs/02-redaction-contract.md` §4 pass
