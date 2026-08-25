# `internal-api` — API contract

**What this is.** The frontend of the internal console is built. This directory records **every HTTP call it makes**, with the exact request and response shape it expects, so `internal-api` can be built against a fixed target rather than a moving one.

**Plus the transporter surface.** Under `ADR-02`, `internal-api` also serves `/api/v1/portal/*` — reached through the `vendor-api` proxy, called by no internal screen. Those contracts are in [`11-portal.md`](11-portal.md) and follow different rules for errors, idempotency and file upload. Files `01`–`10` are the internal surface only.

**Authority.** `docs/specs/internal-spec/*` is the specification. These files add nothing to it; they pin down the wire format the specification leaves open. Where the two disagree, the spec part wins and this file is wrong.

**Status.** Every endpoint below is **implemented on the frontend and mocked**, not implemented on the backend. The mock lives at `apps/internal-portal/src/mocks/` and returns exactly these shapes; it is the acceptance sample for each endpoint. Set `NEXT_PUBLIC_USE_MOCKS=0` to point the portal at a real `internal-api` — no page changes.

---

## The files

| File | Wave | Covers |
|---|---|---|
| [00-conventions](00-conventions.md) | — | Envelope, errors, auth, permissions, money, approvals, idempotency, pagination, attachments |
| [01-foundation](01-foundation.md) | C1 | Session, config, number series, roles matrix, approvals, attachments |
| [02-vendors-compliance](02-vendors-compliance.md) | C2 | Vendors, KYC, documents, activation, leads, market gap, issues, compliance desk |
| [03-clients-indents](03-clients-indents.md) | C3 | Clients, rate cards, indents, quotes, award, placement, trip creation |
| [04-trips-lr](04-trips-lr.md) | C4 | Trip search and detail, documents, cross-check, charges, lorry receipt |
| [05-pod](05-pod.md) | C5 | Receiving register, verify, approve, reject, chase list, waiver |
| [06-payments](06-payments.md) | C6 | Advance gate, balance gate, transporter bills |
| [07-invoicing](07-invoicing.md) | C7 | Invoices, receipts, receivables |
| [08-rfq](08-rfq.md) | C8 | RFQ, lanes, sourcing, quote build-up, award |
| [09-reporting](09-reporting.md) | C9 | Today, Home, P&L, exports |
| [10-telematics-import](10-telematics-import.md) | C10 · C11 | Fleet board, ping ingest, go-live import |
| [11-portal](11-portal.md) | P1–P7 | **Transporter surface.** All 18 `/portal/*` routes, service-key provenance, per-write idempotency, multipart upload, error mapping (`ADR-02`) |

---

## Screen → endpoint map

Every route in `apps/internal-portal/src/app/` and the calls it makes.

| Route | Endpoints |
|---|---|
| *(every page)* | `GET /auth/session` · `GET /approvals?status=PENDING` |
| `/today` | `GET /reports/today` |
| `/home` | `GET /reports/home?month=` |
| `/pnl` | `GET /pnl` · `GET /pnl/exceptions` · `GET /pnl/export.csv` |
| `/print/pnl` | `GET /pnl` · `GET /config` |
| `/vendors` | `GET /vendors` |
| `/vendors/new` | `POST /vendors` · `PATCH /vendors/:id` · `POST /attachments` · `POST /vendors/:id/kyc/:kind` · `POST /vendors/:id/documents/:kind` · `POST /vendors/:id/submit` |
| `/vendors/[id]` | `GET /vendors/:id` · `POST /vendors/:id/kyc/:kind/verify` · `POST /vendors/:id/activate` · `PATCH /vendors/:id/advance-policy` |
| `/vendors/leads` | `GET /vendors/leads` · `PATCH /vendors/leads/:id` |
| `/vendors/market-gap` | `GET /vendors/market-gap` · `PATCH /vendors/market-gap/:id` |
| `/vendors/issues` | `GET /vendors/issues` · `PATCH /vendors/issues/:id` |
| `/compliance` | `GET /compliance/queues` |
| `/clients` | `GET /clients` |
| `/clients/new` | `POST /clients` |
| `/clients/[id]` | `GET /clients/:id` · `GET /clients/:id/rate-card` |
| `/indents` | `GET /indents` |
| `/indents/new` | `GET /clients` · `GET /clients/:id/rate-card` · `POST /attachments` · `POST /indents` |
| `/indents/[id]` | `GET /indents/:id` · `POST /indents/:id/award` · `POST /indents/:id/placement` · `POST /indents/:id/trip` · `GET /payments/advance/:indentId` · `POST /payments/advance/:indentId` |
| `/trips` | `GET /trips` |
| `/trips/[id]` | `GET /trips/:id` · advance and balance gate calls |
| `/trips/[id]/documents` | `GET /trips/:id/documents` · `GET /trips/:id/cross-check` · `POST /attachments` · `POST /trips/:id/documents/:kind` · `.../verify` · `.../reject` · `POST /trips/:id/cross-check/override` |
| `/trips/[id]/charges` | `GET /trips/:id/charges` · `POST /trips/:id/charges` |
| `/trips/[id]/lr` | `GET /trips/:id` · `GET /trips/:id/lr` · `PATCH /trips/:id/lr` · `POST /trips/:id/lr/generate` · `POST /trips/:id/lr/share` · `GET /trips/:id/cross-check` |
| `/print/lr/[tripId]` | `GET /trips/:id` · `GET /config` |
| `/pod/receiving` | `GET /pod/receiving` · `POST /pod/:tripId/receive` |
| `/pod/pending` | `GET /pod/pending` · `POST /pod/:tripId/waive` · `GET /pod/pending/export.csv` |
| `/pod/[id]/verify` | `GET /pod/:tripId` · `POST /pod/:tripId/verify` · `.../reject` · `.../approve` |
| `/payments/advance` | `GET /payments/advance` · `GET /payments/advance/:indentId` · `POST /payments/advance/:indentId` |
| `/payments/balance` | `GET /payments/balance` · `GET /payments/balance/:tripId` · `POST /payments/balance/:tripId` |
| `/payments/bills` | `GET /payments/bills` · `POST /payments/bills/:id/accept` · `POST /payments/bills/:id/query` |
| `/invoices` | `GET /invoices` |
| `/invoices/new` | `GET /clients` · `GET /trips?stage=DELIVERED` · `POST /invoices` · `POST /invoices/:id/generate` |
| `/invoices/[id]` | `GET /invoices/:id` · `POST /invoices/:id/generate` · `POST /invoices/:id/cancel` |
| `/print/invoice/[invoiceId]` | `GET /invoices/:id` |
| `/receivables` | `GET /receivables` · `POST /receipts` |
| `/rfq` | `GET /rfqs` |
| `/rfq/new` | `GET /clients` · `POST /rfqs` |
| `/rfq/[id]` | `GET /rfqs/:id` · `POST /rfqs/:id/lanes` · `POST /rfqs/:id/submit` |
| `/rfq/[id]/lanes/[laneId]/sourcing` | `GET /rfqs/:id` · `PATCH /rfqs/:id/lanes/:laneId/sourcing` |
| `/rfq/[id]/lanes/[laneId]/quote` | `GET /rfqs/:id` · `GET /config` · `PATCH /rfqs/:id/lanes/:laneId/buildup` |
| `/rfq/[id]/award` | `GET /rfqs/:id` · `POST /rfqs/:id/award` |
| `/telematics` | `GET /telematics` |
| `/admin` | `GET /config` · `PATCH /config` · `GET /config/number-series` · `PATCH /config/number-series/:key` |
| `/admin/branches` | `GET /branches` · `POST /branches` · `PATCH /branches/:id` |
| `/admin/roles` | `GET /admin/roles` · `PATCH /admin/roles/:role/permissions` |
| `/admin/approvals` | `GET /approvals` · `POST /approvals/:id/approve` · `POST /approvals/:id/reject` |
| `/admin/import` | `POST /admin/import/:set` · `POST /admin/import/:set/commit` · `GET /admin/import/history` |

---

## Endpoints the frontend never calls

These belong to `internal-api` but no screen invokes them. They are listed so the backend does not assume the frontend covers them.

| Endpoint | Who calls it |
|---|---|
| `POST /telematics/ping` | The GPS provider's webhook, HMAC-signed, no JWT |
| Background jobs (`pod-ageing`, `placement-failure`, `eway-expiry`, `invoice-ageing`, `charge-capture-exception`, `forfeiture-report`, `notification-dispatch`, `attachment-retention`, `identity-image-purge`, `bank-reconciliation`) | The scheduler — part 13 §3 |
| `/api/v1/portal/*` | `vendor-api` (port 4001), proxying on behalf of `vendor-portal`. No internal screen calls these. Contracts in [`11-portal.md`](11-portal.md) (`ADR-02`) |

---

## Open questions for the backend

Answer these before C6 releases a balance carrying a penalty.

1. **Rejected POD backdating.** `BR-52` says rejection does not stop the clock; it does not say whether the stopped period is backdated. The frontend renders whatever `penaltyPaise` the server returns and takes no position. Part 06 §3 flags this as needing business sign-off.
2. **`GET /trips/:id/cross-check` when the LR is a draft.** The frontend treats `runnable: false` with a `waitingOn` list as the normal early state, not an error.
3. **Branch scoping.** Every list endpoint is expected to scope itself for `BRANCH_MGR` at the repository layer. No frontend call passes a branch filter for that purpose, and the P&L test must assert the endpoint, not the screen.
