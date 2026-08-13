# Part 02 · Data model — wave C1, reference for all waves

| | |
|---|---|
| **Wave** | C1 — written in the same migration as the roles |
| **Depends on** | Part 01 |
| **Rules owned** | `NFR-09`, plus every rule in §6 that a constraint can carry |
| **Consumed by** | Every part. Spec 1 §5.2 points here for the DDL |

FSD B5 defines thirteen entities. This is the schema carrying them, plus the operational tables the FSD implies but does not name. Postgres, Supabase-managed.

**Money is `bigint` paise throughout** (`NFR-09`). No `float`, no `numeric`, no rupee-denominated column anywhere. Rounding to the rupee happens once, at the invoice total (`invoices.round_off`) — charge lines, penalty accrual, the advance split and margin all stay exact. The API transports paise as integers; `₹` formatting is presentation. Spec 1 §3.1 declares the same unit, so this is one unit across both applications.

---

## 1 · Identity and configuration

```
users               id, auth_user_id, name, email, phone, role_id, branch_id, status
roles               id, code, name, is_system
permissions         id, code                              -- payment.release, pod.verify, …
role_permissions    role_id, permission_id, level         -- NONE | VIEW | EDIT
branches            id, code, name, city, lat, lng, catchment_km default 150
config              key, value jsonb, updated_by, updated_at
number_series       key, prefix, next_value, width, scope, branch_id null
audit_events        see part 01 §8
attachments         id, kind, entity_type, entity_id, storage_path, mime, bytes,
                    uploaded_by, uploaded_at, retain_until, sha256
approvals           id, kind, entity_type, entity_id, requester_id, reason,
                    payload jsonb, status, approver_id, decided_at, note
```

`attachments.sha256` exists so a re-uploaded POD is recognisable as the same image and an import can be replayed idempotently.

---

## 2 · Supply

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

---

## 3 · Demand and rates

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

`rate_card_lanes.rfq_lane_id` is **`NOT NULL`** — a rate card line with no RFQ provenance cannot exist. That is `BR-37` enforced by the schema rather than by a service, and it is why part 12 imports client rate cards against a synthetic closed RFQ.

---

## 4 · Orders

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

---

## 5 · Money in

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

---

## 6 · Constraints that carry business rules

Rules a database can enforce, are — so a service bug cannot bypass them.

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

Rules needing context — `BR-01`, `BR-07`, `BR-10`, `BR-39`, `BR-40`, `BR-57`, `BR-58` — live in services, each with the e2e test part 13 requires.

---

## 7 · Database roles — `ADR-01`

Both roles are created in the same migration as the tables. A grant added later is a grant that gets forgotten.

| Role | Grants |
|---|---|
| `internal_api` | Full DML on every table **except** `audit_events`, where it holds `INSERT` and `SELECT` only |
| `vendor_api` | Column-level `SELECT` only on the subset Spec 1 needs, plus `INSERT`/`UPDATE` on `quotes`, `vendor_fleet`, `pod_receipts` (attach fields), `vendor_bills`, `attachments`. **No grant at all** on `indents.client_id`, `indents.sell_rate`, `clients`, `invoices`, `receipts`, `rfqs`, `rate_card_lanes`, `trip_charges.billed_amount` |

`BR-55` stops being "we remembered to redact" and becomes "the credential cannot read the column". A DTO that forgets an `@Exclude()` is a code review away from leaking; a missing `GRANT` is not.

---

## 8 · Indexes

`NFR-05` is a small-data system — no sharding, no read replicas, no cache layer in the first release. These three carry every list screen:

```
indents (stage, pickup_date)
trips   (pod_status, delivered_at)
trips   (branch_id, delivered_at)
```

---

## 9 · Done when

- [ ] Every table above exists with the constraints of §6
- [ ] `psql` as `vendor_api` cannot `SELECT indents.sell_rate` — proven by test, not by inspection
- [ ] No column anywhere is `numeric`, `float`, `real` or `money`
- [ ] `audit_events` `UPDATE` and `DELETE` raise
- [ ] `rate_card_lanes` rejects a row with a null `rfq_lane_id`
