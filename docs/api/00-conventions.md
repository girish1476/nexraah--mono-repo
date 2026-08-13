# Conventions

Everything in this directory assumes what follows. An endpoint that departs from it must say so in its own entry.

---

## 1 · Base URL and transport

```
http://localhost:4002/api/v1
```

Set on the frontend by `NEXT_PUBLIC_API_BASE_URL` (`apps/internal-portal/.env.local`). The global prefix is `api/v1`, set in `apps/internal-api/src/main.ts`.

All request and response bodies are JSON, except `POST /attachments` and `POST /admin/import/:set`, which are `multipart/form-data`.

---

## 2 · Response envelope

Success — produced by `TransformInterceptor`:

```json
{ "success": true, "data": { } }
```

`data` is the payload. Lists are a bare array in `data`, not an object with a `rows` key, unless the endpoint also returns stats (`/pod/receiving`, `/pod/pending`, `/rfqs`, `/receivables`).

The frontend unwraps this in `src/apis.ts::request()` and hands pages `data` directly. **A response without the envelope will read as `undefined` on every screen.**

---

## 3 · Errors

Produced by `AllExceptionsFilter`:

```json
{
  "success": false,
  "statusCode": 409,
  "path": "/api/v1/payments/advance/i-4443",
  "timestamp": "2026-08-10T18:22:03.114Z",
  "error": {
    "code": "ADVANCE_BLOCKED",
    "message": "The advance is blocked by unverified documents.",
    "details": { "unmet": [ /* see §6 */ ] }
  }
}
```

`error` may also be a bare string, which the frontend renders as the message with code `ERROR`. **Prefer the object form**: the `code` is what pages branch on, and the `details` are what blocked panels render.

Codes the frontend handles by name:

| Code | Status | Raised by | Frontend behaviour |
|---|---|---|---|
| `ADVANCE_BLOCKED` | 409 | `POST /payments/advance/:indentId` | Re-renders the blocked panel from `details.unmet` |
| `BALANCE_BLOCKED` | 409 | `POST /payments/balance/:tripId` | Same |
| `POD_FORFEITED` | 409 | `POST /payments/balance/:tripId` | Replaces the panel with the forfeiture notice |
| `VENDOR_INCOMPLETE` | 409 | `POST /vendors/:id/submit`, `/activate` | Lists `details.unmet` under the activation gate |
| `VENDOR_NOT_ACTIVE` | 409 | `POST /indents/:id/award` | Toast; the award control stays as it was |
| `APPROVER_IS_VERIFIER` | 409 | `POST /pod/:tripId/approve` | Toast naming BR-50 |
| `PERMISSION_FIXED` | 409 | `PATCH /admin/roles/:role/permissions` | Toast; the checkbox reverts |
| `SERIES_LOWERED` | 409 | `PATCH /config/number-series/:key` | Toast; the value reverts |
| `REASON_TOO_SHORT` | 400 | Override, waiver, policy change | Toast; the dialog stays open |
| Anything else | any | any | `error.message` in a toast or an error panel |

`401` clears the stored token. `403` is expected wherever a permission is missing and is never treated as a bug — part 01 §2.2's "control not rendered" is presentation on top of the server rule, and the test asserts both.

---

## 4 · Authentication and permissions

```
Authorization: Bearer <supabase jwt>
```

Every endpoint carries `@UseGuards(SupabaseJwtGuard, PermissionsGuard)` and a `@RequirePermission(...)`. A principal with **no internal role** is rejected outright before any permission check — a transporter's token is issued by the same Supabase project, and "no permission" and "wrong audience" must not return the same error (part 01 §2.5).

`GET /auth/session` is the first call every page makes. Its `permissions` array is authoritative; the seed grants in `src/lib/permissions.ts` are only a fallback for the moment before it resolves.

**`X-Debug-Role`** — the portal sends this header while the prototype role switcher exists. A real `internal-api` **must ignore it**. It is read only by the mock adapter and is deleted when Supabase auth lands.

---

## 5 · Money and units

**Every money value on the wire is an integer of paise**, and every field carrying one is named `…Paise`. There is no `float`, no `numeric` and no rupee-denominated field anywhere (`NFR-09`).

- `4680000` is ₹46,800.
- Rupee rounding happens exactly once, server-side, at `invoices.roundOffPaise`.
- The frontend formats with `src/lib/format.ts`; it never rounds a payable figure.

Dates are ISO 8601 strings. Date-only fields (`pickupDate`, `receivedOn`, `valueDate`) are `YYYY-MM-DD`. Everything else is a full timestamp.

Enums are `SCREAMING_SNAKE_CASE` strings, never integers.

---

## 6 · Blocked states — the unmet list

Any endpoint that refuses because a precondition is unmet returns the list **by name**:

```json
{
  "unmet": [
    { "key": "EWAY_BILL",       "label": "E-way bill uploaded but not verified", "state": "UNVERIFIED" },
    { "key": "DRIVING_LICENCE", "label": "Driving licence not uploaded",         "state": "MISSING" }
  ]
}
```

`state` is one of `MISSING · UNVERIFIED · REJECTED · BLOCKED`.

The gate endpoints (`GET /payments/advance/:indentId`, `GET /payments/balance/:tripId`, `GET /vendors/:id`) return the same list on the happy path, so the panel can render before anyone presses anything.

**The frontend never computes this list.** It renders what the server says. If the server's idea of what is blocking differs from the screen's, the server is right by construction.

---

## 7 · Approvals — `202` is not an error

Six actions cannot complete directly. They return **`202 Accepted`** with:

```json
{
  "success": true,
  "data": {
    "approvalRequired": true,
    "approval": {
      "id": "apr-7",
      "kind": "ABOVE_BAND_PRICE",
      "entityType": "indent",
      "entityId": "IND-4468",
      "requesterId": "u-bm",
      "requesterName": "Sunita Rao · BRANCH_MGR",
      "approverRole": "LEADERSHIP",
      "requiredPermission": "approve.above_band",
      "reason": "…",
      "status": "PENDING",
      "createdAt": "2026-08-10T09:40:00.000Z"
    }
  }
}
```

`src/apis.ts` turns this into a thrown `ApprovalRequiredError`; the calling page catches it, disables the originating control, shows `Awaiting approval` and does **not** show a success toast.

The six kinds: `ABOVE_BAND_PRICE` · `ADVANCE_OVERRIDE` · `ADVANCE_POLICY_CHANGE` · `PENALTY_WAIVER` · `DOC_OVERRIDE` · `BRANCH_OVERRIDE`.

On approval the stored payload is replayed **verbatim**, never recomputed. If replay is no longer valid the approval fails closed with `409` and the reason.

`requiredPermission` is what the approvals inbox filters on to decide whose queue a request belongs in, and what the sidebar badge counts.

---

## 8 · Idempotency

`POST /payments/advance/:indentId` and `POST /payments/balance/:tripId` require:

```
Idempotency-Key: <uuid>
```

Unique-constrained on `payments.idempotency_key`. A repeat with the same key returns the **original payment row and a 200**, not a duplicate and not an error. The frontend mints one key per attempt and reuses it across retries; it mints a fresh one only after a success.

---

## 9 · Lists, filters and exports

Filters are query parameters, snake_case where the specification names them so (`pod_status`), camelCase nowhere in a query string. Absent means "all"; the frontend omits empty values rather than sending `""`.

There is no pagination in the first release. `NFR-05` is a small-data system — 150–200 trips a month — and every list screen is expected to return its full filtered set. Adding pagination later is a response-shape change these documents will have to record.

CSV exports (`/pod/pending/export.csv`, `/pnl/export.csv`) are linked directly by `<a href>`, so they must accept the **bearer token by cookie or a signed URL**, not only by header. This is the one place the frontend cannot attach an `Authorization` header.

---

## 10 · Attachments

```
POST /attachments        multipart → { "id": "att-…", "sha256": "…", "uploadedAt": "…" }
GET  /attachments/:id/url             → { "url": "https://…", "expiresAt": "…" }
```

Signed URLs expire in **15 minutes**. Every row carries `sha256`, `retain_until` and the uploading actor. Identity images are encrypted at rest with access restricted to `COMPLIANCE` (`NFR-04`).

The upload-then-reference pattern is used everywhere: the frontend uploads first, gets an id, then sends that id on the domain call. No domain endpoint accepts a file body.

---

## 11 · Audit

Every mutation writes an `audit_events` row **inside the same transaction** (`NFR-03`). No endpoint returns the audit row, and no screen reads the trail today; the obligation is on the write path only.

---

## 12 · What the frontend assumes about ordering

- `GET /pod/pending` returns oldest first.
- `GET /indents/:id` returns quotes in any order; the screen sorts them cheapest first.
- `GET /approvals` returns newest first.
- Everything else is unordered and the screen does not depend on it.
