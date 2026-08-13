# Part 07 · Payments — wave C6

| | |
|---|---|
| **Wave** | C6 — closes both money gates. C5 + C6 is the end of the spine |
| **Depends on** | 05 (documents), 06 (POD approved) |
| **Rules owned** | `BR-07`, `BR-08`, `BR-09`, `BR-10`, `BR-11`, `BR-33`, `BR-53`, `BR-58` (gate half), `BR-24`/`BR-25` (deduction half), `BR-40` (finance only) |
| **Screens** | `/payments/advance`, `/payments/balance`, `/payments/bills` |
| **Permission** | `payment.release` — **FINANCE only, not grantable elsewhere** (`BR-40`) |

> **The two money gates.** The advance is gated on document verification. The balance is gated on the POD. Both are enforced in the interface — the panel states plainly what is missing and the button cannot be pressed — and both are enforced server-side regardless of what the interface did.

Three queues. Each row shows what is releasable, what is blocked, and the checklist of what would unblock it. The panels on `/indents/[id]` and `/trips/[id]` are the same component scoped to one record.

---

## 1 · Advance

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

The set is read from `config.advance_document_set` (part 01 §4.2). **Any member missing or unverified appears by name in the blocked panel** — the third pattern of part 01 §2.2 is the product here, not a nicety:

```
🔒 Advance blocked
   ✗ Fitness certificate not uploaded
   ✗ E-way bill uploaded but not verified
   ✓ Registration certificate verified
   …
```

`advance_pct` comes from the vendor's standing policy (`BR-30`); a departure from it was approved at part 04 §2 under `BR-57` before it ever reaches here. **The amount is not editable at payment** (`BR-08`) — the figure is derived, displayed and released, never keyed.

**No TDS is deducted in this release** (`BR-33`, `D-24`). The declaration is held on the vendor file. When deduction begins it applies to the amount actually paid, not the whole freight.

---

## 2 · Balance

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

**The deduction breakdown must be shown**, not just a net figure:

```
Billable                   ₹41,500
Less advance paid         −₹12,450
Less POD penalty (4 days)    −₹400   ⓘ ₹100/day beyond 20 days
Net payable                ₹28,650
```

A transporter who is paid a net figure with no working disputes it. A transporter shown the working argues about the penalty, which is a conversation the system can answer.

`payments.net` is a generated column (`gross − penalty`, part 02 §6) so the arithmetic cannot drift between the screen and the row.

---

## 3 · Transporter bill matching — `/payments/bills`

`BR-53`, `MOD-VBL`. Bills submitted in the portal (Spec 1 §4.7) appear in a finance queue with the computed balance beside them and the variance flagged. **A variance does not reject the bill — the transporter may be right.**

**Table:** vendor · their bill number and date · trip · bill total · computed balance · variance in ₹ and % · POD state · attachment · action.

**Actions:**

| Action | Effect |
|---|---|
| `Accept and release` | Releases at the computed figure |
| `Accept at their figure` | Reason required. Raises no approval — finance owns the number under `BR-40` |
| `Query` | Notifies the transporter with a note; the bill stays open |

A bill cannot exist before its POD is approved — enforced at insert (part 02 §4), so this queue never holds a premature bill.

---

## 4 · Endpoints

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

Every `POST` here writes an `audit_events` row inside the same transaction (`NFR-03`) and is **idempotent on a client-supplied `Idempotency-Key` header**, unique-constrained on `payments.idempotency_key`. A double-submitted advance is the one mistake this system must not make, and a retry on a flaky connection is how it would happen.

A `409` carries the unmet condition list by name. The frontend renders that list directly — it never computes its own idea of what is blocking.

---

## 5 · Who may press the button — `BR-40`

`payment.release` seeds to `FINANCE` and is **fixed**: the roles matrix refuses to grant it to a second role (part 01 §5). For every other role the button is not rendered *and* the endpoint returns `403` — the two are independent, and the test asserts both.

---

## 6 · Done when

- [ ] Advance refuses while any of the eight documents is missing or unverified, each named in the `409` (`BR-07`, `BR-58`)
- [ ] Advance stays blocked when fitness, permit or PUC alone is missing
- [ ] Advance amount is derived and cannot be overridden at payment (`BR-08`)
- [ ] Every payment row carries mode, transfer type, remitting account, UTR and value date — `NOT NULL` (`BR-09`)
- [ ] Balance refuses until the POD is `APPROVED` or `WAIVED` (`BR-10`)
- [ ] Balance shows billable, advance, penalty and net as four lines, not one figure
- [ ] A POD past 40 days returns `409 POD_FORFEITED` and pays nothing (`BR-25`)
- [ ] `tds = 0` on every payment (`BR-33`)
- [ ] Two `POST`s with the same `Idempotency-Key` release once
- [ ] A non-finance role gets no button and a `403` (`BR-40`)

**Tests** (part 13 §23): 1, 2, 3, 4, 11, 16.
