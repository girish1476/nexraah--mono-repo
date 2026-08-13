# 06 · Payments — wave C6

The two money gates. Both are enforced in the interface *and* server-side regardless of what the interface did.

**Permission for every endpoint here: `payment.release` — FINANCE only, not grantable to a second role (`BR-40`).** For every other role the control is not rendered *and* the endpoint returns `403`; the two are independent and the test asserts both.

Frontend: `src/app/payments/apis.ts` · `src/components/advance-panel.tsx` · `src/components/balance-panel.tsx`

---

## `GET /payments/advance`

**Query** — `status`.

```json
[{
  "indentId": "i-4443", "indentCode": "IND-4443",
  "tripId": "t-120881", "tripCode": "TRP-120881",
  "vendorName": "Rathod Roadlines", "lane": "Nashik → Kolkata", "branchName": "Nashik",
  "advancePct": 40, "grossPaise": 2336000,
  "blocked": true, "unmetCount": 3
}]
```

---

## `GET /payments/advance/:indentId`

Accepts an indent id, an indent code or a trip id — the panel is rendered from all three screens.

```json
{
  "tripId": "t-120881", "tripCode": "TRP-120881", "indentCode": "IND-4443",
  "vendorName": "Rathod Roadlines",
  "beneficiary": { "accountHolder": "Rathod Roadlines", "account": "••4471", "ifsc": "HDFC0000188" },
  "advancePct": 40,
  "buyRatePaise": 5840000,
  "grossPaise": 2336000,
  "tdsPaise": 0,
  "netPaise": 2336000,
  "unmet": [
    { "key": "DRIVING_LICENCE", "label": "Driving licence not uploaded", "state": "MISSING" },
    { "key": "RC", "label": "Registration certificate uploaded but not verified", "state": "UNVERIFIED" },
    { "key": "EWAY_BILL", "label": "E-way bill not uploaded", "state": "MISSING" }
  ],
  "cleared": [
    { "key": "CLIENT_INVOICE_OR_PO", "label": "Client invoice or purchase order" }
  ],
  "releasable": false,
  "alreadyReleased": false
}
```

```
preconditions: indent VEHICLE_PLACED · trip exists
               every member of config.advance_document_set VERIFIED       BR-07, BR-58
amount:        gross = buy_rate × advance_pct / 100   locked, not editable  BR-08
               tds   = 0                                                   BR-33, D-24
```

The screen renders `unmet` and `cleared` **exactly as given**. It has no idea which documents are in the set and must not acquire one.

`advancePct` comes from the vendor's standing policy (`BR-30`); a departure was approved under `BR-57` before it ever reached here. **The amount is not editable at payment** — derived, displayed, released, never keyed.

---

## `POST /payments/advance/:indentId`

**Headers** — `Idempotency-Key: <uuid>` (mandatory).

```json
{ "mode": "NEFT", "transferType": "VENDOR_ACCOUNT",
  "remittingAccount": "HDFC ••4471", "utr": "SBIN26081144721", "valueDate": "2026-08-11" }
```

All five are `NOT NULL` on `payments` (`BR-09`); a missing one is `400 PAYMENT_FIELD_REQUIRED`.

| Error | Rule |
|---|---|
| `409 ADVANCE_BLOCKED` + `details.unmet` | `BR-07`, `BR-58` |
| `403` | not FINANCE (`BR-40`) |

A repeat with the same `Idempotency-Key` returns the original payment row. **A double-submitted advance is the one mistake this system must not make, and a retry on a flaky connection is how it would happen.**

**Response** — the payment: `{ id, tripId, tripCode, kind: "ADVANCE", grossPaise, penaltyPaise: 0, netPaise, tdsPaise: 0, releasedBy, releasedAt, utr }`

---

## `GET /payments/balance`

```json
[{
  "tripId": "t-120855", "tripCode": "TRP-120855",
  "vendorName": "Anand Roadways", "lane": "Gandhidham → Jaipur", "branchName": "Gandhidham",
  "podStatus": "APPROVED", "podAgeDays": 3,
  "netPaise": 1904000, "penaltyPaise": 0,
  "blocked": false, "unmetCount": 0
}]
```

---

## `GET /payments/balance/:tripId`

```json
{
  "tripId": "t-120855", "tripCode": "TRP-120855",
  "vendorName": "Anand Roadways", "lane": "Gandhidham → Jaipur",
  "beneficiary": { "accountHolder": "Anand Roadways", "account": "••7745", "ifsc": "SBIN0004471" },
  "podStatus": "APPROVED", "podAgeDays": 3,
  "breakdown": {
    "billablePaise": 3080000,
    "buyRatePaise": 2940000,
    "chargeCostPaise": 140000,
    "advancePaidPaise": 1176000,
    "penaltyPaise": 0,
    "penaltyDays": 0,
    "penaltyPerDayPaise": 10000,
    "grossPaise": 1904000,
    "netPaise": 1904000
  },
  "unmet": [],
  "releasable": true,
  "alreadyReleased": false
}
```

```
preconditions: trip DELIVERED · pod_status APPROVED or WAIVED             BR-10, BR-48
               pod age ≤ 40 days                                          BR-25
amount:  billable = buy_rate + Σ trip_charges.cost_amount
         gross    = billable − advance_paid                               BR-11
         penalty  = trip.pod_penalty (0 if waived)                        BR-24
         net      = gross − penalty
```

**The deduction breakdown must be returned as its components, not as a net figure.** The screen renders four lines:

```
Billable                   ₹41,500
Less advance paid         −₹12,450
Less POD penalty (4 days)    −₹400   ⓘ ₹100/day beyond 20 days
Net payable                ₹28,650
```

A transporter paid a net figure with no working disputes it. A transporter shown the working argues about the penalty — a conversation the system can answer.

`payments.net` is a **generated column** (`gross − penalty`), so the arithmetic cannot drift between the screen and the row.

---

## `POST /payments/balance/:tripId`

Same headers and body as the advance.

| Error | Rule |
|---|---|
| `409 BALANCE_BLOCKED` + `details.unmet` | `BR-10` |
| `409 POD_FORFEITED` | `BR-25` — past 40 days nothing is payable; the trip closes and the forfeiture is reported against the transporter's file |
| `403` | not FINANCE |

---

## Transporter bills — `BR-53`

```
GET  /payments/bills?status=
GET  /payments/bills/:id
POST /payments/bills/:id/accept    { atTheirFigure?, reason? }
POST /payments/bills/:id/query     { note }
```

```json
{
  "id": "vb-2", "tripId": "t-120869", "tripCode": "TRP-120869",
  "vendorId": "v-2301", "vendorName": "Bhagwati Logistics",
  "billNo": "BL/26/1180", "billDate": "…", "attachmentId": "att-bill-2",
  "freightPaise": 4120000, "chargesPaise": 90000, "totalPaise": 4210000,
  "submittedAt": "…",
  "computedBalancePaise": 1236000, "variancePaise": 90000,
  "podStatus": "RECEIVED", "status": "SUBMITTED"
}
```

`status` ∈ `SUBMITTED · ACCEPTED · QUERIED`.

| Action | Effect |
|---|---|
| `accept` | Releases at the **computed** figure |
| `accept` with `atTheirFigure: true` | Releases at **their** figure. `reason` mandatory — `400` without it. Raises **no approval**: finance owns the number under `BR-40` |
| `query` | Notifies the transporter with the note; the bill stays open |

**A variance does not reject the bill — the transporter may be right.**

A bill cannot exist before its POD is approved; that is enforced at insert, so this queue never holds a premature bill.

---

## Done when

- [ ] Advance refuses while any of the eight documents is missing or unverified, each named in the `409`
- [ ] Advance stays blocked when fitness, permit or PUC alone is missing
- [ ] The advance amount is derived and cannot be overridden at payment (`BR-08`)
- [ ] Every payment row carries mode, transfer type, remitting account, UTR and value date (`BR-09`)
- [ ] Balance refuses until the POD is `APPROVED` or `WAIVED` (`BR-10`)
- [ ] The balance response carries billable, advance, penalty and net as four components
- [ ] A POD past 40 days returns `409 POD_FORFEITED` and pays nothing (`BR-25`)
- [ ] `tdsPaise` is `0` on every payment (`BR-33`)
- [ ] Two `POST`s with the same `Idempotency-Key` release once
- [ ] A non-finance role gets no button **and** a `403`
