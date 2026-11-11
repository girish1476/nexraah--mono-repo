# 11 · Cross-cutting — all waves

Endpoint index, NFR obligations, error catalogue, and the test suite that spans parts.

---

## 1 · Full endpoint index

Every path is relative to the global prefix `/api/v1`. `vendor-portal` calls `http://localhost:4001/api/v1/portal/loads`; `vendor-api` proxies it to `internal-api` on 4002, which serves the handler (`ADR-02`). Wire contracts — headers, idempotency, upload, error mapping — are in [`../../api/11-portal.md`](../../api/11-portal.md).

**`vendor-api` proxies `/portal/*` and serves no other path.** It holds no database credentials, no DTO and no rule.

Three routes the screens need are absent from the table below and specified in `11-portal.md` §5: `GET /portal/loads/:code`, `GET /portal/trips/:id`, `GET /portal/trips/:id/bill`.

| Method | Path | Permission | Rules | Part |
|---|---|---|---|---|
| POST | `/portal/auth/login` | — | | 01 |
| GET | `/portal/me` | `portal.self` | | 01 |
| GET | `/portal/loads?truckType=&branch=` | `portal.self` | `BR-55` | 03 |
| POST | `/portal/loads/:code/quote` | `portal.self` | `BR-05` | 03 |
| GET | `/portal/quotes?status=` | `portal.self` | | 03 |
| DELETE | `/portal/quotes/:id` | `portal.self` | Withdraw, only while `SUBMITTED` | 03 |
| GET | `/portal/fleet` | `portal.self` | | 04 |
| POST | `/portal/fleet` | `portal.self` | | 04 |
| PATCH | `/portal/fleet/:id` | `portal.self` | `DOCS_DUE` not caller-settable | 04 |
| GET | `/portal/trips?status=` | `portal.self` | | 05 |
| GET | `/portal/trips/:id/lorry-receipt` | `portal.self` | `BR-54` | 05 |
| POST | `/portal/trips/:id/pod` | `pod.upload` | `BR-51` | 06 |
| POST | `/portal/trips/:id/bill` | `portal.bill` | `BR-53` | 07 |
| GET | `/portal/profile` | `portal.self` | | 08 |
| POST | `/portal/profile/documents/:kind` | `portal.self` | `BR-23` | 08 |

`POST /api/v1/vendors/:id/activate` is an **`internal-api`** route (console part 03), listed in part 01 §2.1 only to show where the account comes from.

---

## 2 · Error catalogue

Consistency matters more than cleverness here — a transporter sees these through a support call, and the branch needs to recognise them.

| Code | Status | Meaning | Part |
|---|---|---|---|
| `VENDOR_SUSPENDED` | 403 | Reads allowed, writes refused | 01 |
| `WRONG_AUDIENCE` | 403 | An internal principal hit `/portal/*` | 01 |
| `SERVICE_KEY_REQUIRED` | 403 | Reached `/portal/*` without the edge's key | 01 |
| `BELOW_BAND` | 422 | Quote below `bidMin`; payload carries `bidMin` | 03 |
| `QUOTE_EXISTS` | 409 | Already quoted; screen offers withdraw | 03 |
| `POD_NOT_APPROVED` | 409 | Bill submitted too early | 07 |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | A write arrived without `Idempotency-Key` | — |
| `UPSTREAM_TIMEOUT` | 504 | The edge gave up on `internal-api` | — |
| — | **404** | Another vendor's record. **Never 403** | 02 |

**An internal error code must never reach a transporter.** Portal handlers now live beside internal services, so `ADVANCE_BLOCKED`, `VENDOR_INCOMPLETE` and the rest of `../../api/00-conventions.md` §3 are one uncaught exception away from a portal response. Map before throwing; an unmapped code escaping to `/portal/*` is a `BR-55` finding. See `11-portal.md` §2.

> **404, never 403, for another vendor's record.** A 403 confirms the record exists. Vendor A probing `/portal/trips/{id}/lorry-receipt` across an id range learns how many trips vendor B is running, which is `NFR-02` leaking through a status code.

---

## 3 · NFR obligations

`NFR-01`, `03`, `05`, `07`–`12` are the console's (console part 13/19). These are the portal's.

| Rule | How this application meets it |
|---|---|
| `NFR-02` | The whole of part 02, plus the `vendor_api` column grants (part 01 §1.2) and repository scoping (part 01 §3). Tested on every deploy |
| `NFR-04` | Aadhaar last four only. Identity images encrypted at rest, compliance-only access, 15-minute signed URLs, deleted on relationship closure (`R-04`, part 08) |
| `NFR-06` | **Phone-first — most transporters will never open a laptop.** Every screen usable at 360px with no horizontal scroll. Four bottom tabs, profile in the header menu. No hover-only affordance anywhere |
| `NFR-09` | `bigint` paise across DTOs, database and computation. `₹` formatting is presentation only |

### `NFR-06` is a harder constraint here than in the console

The console is desktop-first with phone support. This application inverts that. Three consequences worth writing down:

- **No table that cannot become a card.** Quotes and fleet are the two candidates; both collapse below 768px.
- **No multi-column form.** The quote form is one column at every width.
- **Thumb reach.** Primary actions sit at the bottom of the viewport on the quote, POD and bill screens — the three a transporter completes standing up.

---

## 4 · Rate limiting

| Endpoint | Limit | Threat |
|---|---|---|
| `POST /portal/loads/:code/quote` | 30/hour per vendor | — |
| File upload | 60/hour per vendor | — |
| `POST /portal/auth/login` | 10 per 15 min per account | Credential stuffing |
| `GET /portal/loads` | 120/hour, log outliers | **Scripting the endpoint to watch pricing** |

The loads limit is the interesting one. A transporter polling every ten seconds learns which lanes go unfilled and how bands move — market knowledge `BR-55` withholds by construction and polling reassembles by observation. Log the outliers rather than blocking; a keen transporter and a scraper look the same on day one.

---

## 5 · The isolation suite

**Runs on every deploy.** Full detail in part 02 §4. Signed in as vendor A:

1. `GET /portal/loads` — no `clientName`, `sellRate`, `quoteCount` at any depth
2. `GET /portal/trips` — vendor A's trips only
3. `GET /portal/trips/{vendorB_trip}/lorry-receipt` → **404, not 403**
4a. `GET :4001/api/v1/trips`, `/pnl`, `/invoices`, `/compliance` → **404** at the edge
4b. Vendor A's token + service key against `:4002/api/v1/trips` → **403 `WRONG_AUDIENCE`**
4c. A service key against any non-portal `:4002` route → **403 `WRONG_AUDIENCE`**
4d. `/portal/*` without the service key → **403 `SERVICE_KEY_REQUIRED`**
5. Lorry receipt DTO has no `consignor`, `consignee`, `clientInvoiceNo`
6a. As `vendor_api`, `SELECT client_id FROM indents` raises
6b. A portal handler selecting `indents.client_id` raises at runtime; `PortalModule`'s `DB` token resolves to `portalPool`

---

## 6 · Flow tests

Spanning parts, run per release:

- [ ] Quote below band rejected, nothing persisted (03)
- [ ] Quote above band accepted with the leadership warning (03, `D-39`)
- [ ] Fleet vehicle with `DOCS_DUE` cannot be offered on a quote (04)
- [ ] POD attach requires docket and sent-on (06)
- [ ] POD attach does **not** stop the penalty clock (06, `BR-49`)
- [ ] Bill blocked until POD approved (07)
- [ ] Bill above the computed balance is flagged, not rejected (07)
- [ ] Suspended vendor can read but not write (01)
- [ ] A load awarded elsewhere disappears rather than showing a loss state (03)

---

## 7 · Build-order checklist

| Wave | Part | Console dependency | Status |
|---|---|---|---|
| `P1` | 01 · 02 | `C1` | |
| `P2` | 03 | `C2`, `C3` | |
| `P3` | 04 | `C2` | |
| `P4` | 05 | `C4` | |
| `P5` | 06 | `C5` | |
| `P6` | 07 | `C5`, `C6` | |
| `P7` | 08 | `C2` | |
| `P8` | 09 | — | 🔴 Blocked on FSD `B1` change request |
| — | 10 | `C10` dispatch job | |

**P1 before anything else.** Build the redaction contract and its tests first, so every screen after it inherits a payload that is already safe. Retrofitting redaction is how the first version leaked.
