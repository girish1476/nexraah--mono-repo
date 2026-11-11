# Part 13 · Cross-cutting — every wave

| | |
|---|---|
| **Applies to** | All parts |
| **Rules owned** | `NFR-04`–`NFR-07`, `NFR-10`, `NFR-11` |
| **Contains** | NFR obligations, integrations, background jobs, testing |

---

## 1 · Non-functional requirements

Spec 2's obligations under FSD B8. `NFR-02` is Spec 1's.

| Rule | How this spec meets it |
|---|---|
| `NFR-01` | Every endpoint carries `SupabaseJwtGuard` + `PermissionsGuard`. No permission check lives in the frontend alone — part 01 §2.2's "control not rendered" is presentation on top of a server rule, never instead of one |
| `NFR-03` | Part 01 §8 |
| `NFR-04` | Aadhaar stored as last-4 only (`BR-04`). Identity images encrypted at rest, access restricted to `COMPLIANCE`, signed URLs at 15-minute expiry, deleted on relationship closure by a scheduled job (`R-04`) |
| `NFR-05` | **Sizing baseline: 150–200 trips a month, ≥20 concurrent internal users, 200 transporter accounts, 1.5× Feb–Jun peak** (`D-30`). Roughly 2,400 trips, 12,000 documents and 4,800 payments a year. This is a small-data system: no sharding, no read replicas, no cache layer in the first release. The three indexes in part 02 §8 carry every list screen. The architecture must not preclude an order-of-magnitude increase; the first release must not be provisioned for one |
| `NFR-06` | Desktop-first, full function on tablet, **every screen usable on a phone**. Today, POD receiving/verify and the approvals inbox are phone-*optimised* — the three used away from a desk. Tables collapse to cards below 768px; no screen requires horizontal scroll |
| `NFR-07` | Supabase daily automated backup, 30-day point-in-time recovery. A restore runbook lives at `docs/ops/restore.md` and is **exercised quarterly against a scratch project**, with the measured RTO recorded there. An untested backup is not a backup |
| `NFR-08` | Part 01 §4.1 |
| `NFR-09` | **All money is `bigint` paise.** Part 02 |
| `NFR-10` | Invoices, receipts, LRs, PODs and audit rows retained **8 years** — GST requires 6 from the annual return, income-tax 8; the longer governs. `attachment-retention` deletes only attachments past their own `retain_until` and never a document class inside its statutory window. Identity images follow `BR-46` |
| `NFR-11` | Peak is 1.5× of a small baseline. No autoscaling needed; the requirement is met by not shipping an N+1 on the list screens. Load test at 300 trips a month before go-live |
| `NFR-12` | Part 12 |

---

## 2 · Integrations

FSD B7 lists eight.

| Integration | Priority | Wave | Approach |
|---|---|---|---|
| **Document storage** | High | C1 | Supabase Storage. Signed URLs, 15-minute expiry. Nothing stores files today |
| **Messaging gateway** | Ready | C1 | DLT-registered gateway already integrated (`D-31`). Remaining work is template registration and event mapping; the event list is part 11 §4 and Spec 1 §7 |
| **KYC agency** | Medium | C2 | Manual route first (`D-08`) — compliance verifies uploaded photographs. The API sits behind `config.kyc_route` as an accelerator, never a dependency |
| **GSTN** | Low | C3 | GSTIN format and validity check on vendor and client onboarding. **Advisory only** — a failed check warns and does not block, because a small transporter may legitimately sit below the registration threshold (FSD B3.1) |
| **NIC e-way bill** | **High** | C4 | Fetch number, validity and status instead of typing them; detect extension and cancellation. Until connected, values are keyed on the trip document and `eway-expiry` works from `trips.eway_valid_till`. Connecting it replaces the keyed value with a fetched one and makes the `BR-32` vehicle-number cross-check authoritative rather than typo-prone. Read-only — Nexraah does not generate e-way bills |
| **Banking** | Medium | C6 | Two separable capabilities. **(a) UTR reconciliation** — match released payments against a bank statement feed on amount + value date + account, and flag any payment whose UTR was keyed but never appears. **(b) Payment initiation** — out of scope for the first release; finance pays by internet banking and keys the UTR (`BR-09`). Do (a) first: it catches a mis-keyed UTR, which is the failure that actually happens |
| **GPS / telematics** | High | C10 | `POST /telematics/ping`, HMAC-signed webhook. Part 11 |
| **Accounting system** | Medium | C7 | One-way periodic export of issued invoices, receipts and released payments as a journal file, plus a reconciliation report of whatever the accounting system rejected. Nexraah is not the books of account (FSD B1) and must not drift into becoming them |

---

## 3 · Background jobs

Single worker, distributed lock.

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
| `attachment-retention` | Weekly | Past `retain_until`, respecting the statutory windows of `NFR-10`. **Never touches `audit_events`** |
| `identity-image-purge` | Weekly | Identity images on relationships closed past their window (`BR-46`, `R-04`) |
| `bank-reconciliation` | Daily, once banking connects | Flag payments whose UTR never appears on the statement |

---

## 4 · Testing

**One e2e test per business rule.** A rule without a passing test is not done. Fifty-eight rules, `BR-01`–`BR-58`.

### 4.1 Critical flows

| # | Flow | Part |
|---|---|---|
| 1 | Advance blocked → verify all eight documents of `BR-58` → releases → UTR captured | 05 · 07 |
| 2 | Advance stays blocked when fitness, permit or PUC alone is missing (`BR-58`) | 07 |
| 3 | Balance blocked → POD attached → received → verified → approved → releases with penalty deducted | 06 · 07 |
| 4 | POD past 40 days → balance refused, forfeiture recorded | 06 · 07 |
| 5 | POD rejected at verification → clock resumes, `pod_received_at` cleared | 06 |
| 6 | Verifier attempts to approve their own POD → refused at the service **and** by the database constraint (`BR-50`) | 06 · 02 |
| 7 | Above-band quote accepted and flagged; award → 202 → leadership approves → award completes and writes `buy_rate` (`BR-05`, `BR-06`, `D-39`) | 04 |
| 8 | Below-band quote refused at entry and never persisted (`BR-05`) | 04 · Spec 1 |
| 9 | Spot indent without rate approval → blocked | 04 |
| 10 | Invoice screen and printed document contain no GST anywhere | 08 |
| 11 | Non-finance role: payment button not rendered, **and** the endpoint returns 403 | 01 · 07 |
| 12 | Branch manager sees only their branch in P&L | 10 |
| 13 | Advance policy change → 202 `ADVANCE_POLICY_CHANGE`, not applied until approved (`BR-57`) | 03 · 04 |
| 14 | Bid band cannot be widened after publication, with or without quotes (`BR-39`) | 04 |
| 15 | Concurrent LR generation issues no duplicate and leaves no gap (`NFR-08`) | 01 · 05 |
| 16 | Double-submitted advance with the same `Idempotency-Key` releases once | 07 |
| 17 | `audit_events` rejects `UPDATE` and `DELETE` (`NFR-03`) | 01 · 02 |
| 18 | Import cannot set a vendor `ACTIVE` (`NFR-12`, `BR-01`) | 12 |

### 4.2 Coverage gates

90% on `payments`, `pod`, `indents`, `identity`. 70% elsewhere.

---

## 5 · Build risks carried from FSD B9

| Ref | Risk | Where it is handled |
|---|---|---|
| `R-01` | Margin accuracy depends entirely on charge capture from the POD | Charge entry is part of POD verification, not a separate step (part 06 §3). `charge-capture-exception` job + P&L exception panel (part 10 §3) |
| `R-02` | Forfeiting a balance at 40 days is commercially severe and may damage supply on thin lanes | `forfeiture-report` monthly by transporter (§3). A pattern is a supply problem |
| `R-03` | The RFQ build-up is only as good as the sourcing rate operations supplies | Components stored per lane and compared against actual placement rates once the lane runs (part 09 §2) |
| `R-04` | Retaining Aadhaar images for the life of the relationship is a growing data-protection obligation | Encrypted at rest, compliance-only access, `identity-image-purge` job (§3, part 03 §5) |
| `R-05` | The prototype is behind the specification in four places | Treated as a design reference, not a starting codebase |

---

## 6 · Open for business sign-off

Two items are decided by the business, not by the build. Both are named in the parts that depend on them.

| Item | Where | Needed before |
|---|---|---|
| Does a rejected POD backdate the penalty over the period the clock was stopped, or resume from the rejection date? `BR-52` does not say | Part 06 §3 | C6 releases a balance carrying a penalty |
| Does the Expo shell ship? FSD B1 says the transporter portal is web only in version one | Spec 1 §1.3 | Spec 1 `P8` |
