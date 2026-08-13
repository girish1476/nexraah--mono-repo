# 03 · Clients and indents — wave C3

Record demand, discover a price for it, place a truck against it.

Frontend: `src/app/clients/apis.ts` · `src/app/indents/apis.ts`

---

## Clients

```
GET   /clients?q=
POST  /clients
GET   /clients/:id
PATCH /clients/:id
GET   /clients/:id/rate-card
```

**Client**

```json
{
  "id": "c-0092", "code": "CLT-0092", "name": "Berger Paints",
  "billingCity": "Kolkata", "gstin": "19AAACB2545C1Z9",
  "contact": "A. Bose", "phone": "9830011223", "email": "logistics@berger.example",
  "engagement": "CONTRACT",
  "agreementNo": "BRG/RC/2026-27", "validFrom": "2026-04-01", "validTo": "2027-03-31",
  "agreementAttachmentId": "att-…",
  "creditDays": 45, "serviceLevel": "Same day placement",
  "status": "ACTIVE", "outstandingPaise": 84200000
}
```

`engagement` ∈ `SPOT · CONTRACT`. GSTIN is checked against GSTN where present — **advisory, never blocking**: a small transporter or client may legitimately sit below the registration threshold.

### `GET /clients/:id/rate-card`

**Read-only on this side.** These rows are what RFQ award wrote (`BR-37`).

```json
[{
  "id": "rc-1", "rfqLaneId": "rl-1",
  "origin": "Kolkata", "destination": "Nashik", "truckType": "32 ft SXL",
  "ratePaise": 6420000, "transitDays": 5, "reportingRule": "NEXT_DAY",
  "validFrom": "2026-04-01", "validTo": "2027-03-31"
}]
```

`rfqLaneId` is `NOT NULL` in the schema — a rate card line with no RFQ provenance cannot exist. Part 12 imports client rate cards against a **synthetic closed RFQ** for exactly this reason.

A `SPOT` client returns `[]`, and the screen says *"Rates are set per indent with the client's written approval."*

---

## `GET /indents`

**Query** — `stage`, `branch`, `client`.

```json
[{
  "id": "i-4471", "code": "IND-4471", "clientName": "Sanghvi Metals",
  "lane": "Bhiwandi → Hyderabad", "material": "CR steel coils",
  "weightTn": 21, "truckType": "32 ft SXL", "pickupDate": "2026-08-11T00:00:00.000Z",
  "sellRatePaise": 4680000, "buyRatePaise": null,
  "quoteCount": 3, "stage": "OPEN", "branchName": "Vijayawada",
  "failureCause": null
}]
```

`stage` ∈ `OPEN · VENDOR_ASSIGNED · VEHICLE_PLACED · TRIP_CREATED`.
`failureCause` is written nightly by the `placement-failure` job (`BR-18`), never by a screen.

---

## `GET /indents/:id`

Adds `quotes[]` and the pricing block:

```json
{
  "rateSource": "SPOT",
  "sellRatePaise": 4680000,
  "sourcingRatePaise": 4020000,
  "spotConfirmationAttachmentId": "att-spot-4471",
  "rateCardLaneId": null,
  "bidMinPaise": 3800000,
  "bidMaxPaise": 4250000,
  "bandLocked": true,
  "advancePct": 40,
  "transitDays": 2,
  "reportingRule": "SAME_DAY",
  "remarks": "Coils must be chocked.",
  "distanceKm": 712,
  "vehicleNo": null, "driverName": null, "driverLicence": null, "reportedAt": null,
  "quotes": [{
    "id": "q-1", "code": "BID-9908",
    "vendorId": "v-2214", "vendorName": "Rathod Roadlines",
    "vendorStatus": "PENDING_VERIFICATION",
    "amountPaise": 4020000, "truckRegistration": "MH 15 GT 4482",
    "bandPosition": "IN_BAND", "status": "SUBMITTED",
    "submittedAt": "…", "remarks": ""
  }]
}
```

**`sellRatePaise` is internal.** It is never present on any transporter-facing response — the `vendor_api` database role holds no grant on the column at all, so a forgotten `@Exclude()` cannot leak it (`BR-55`).

**`vendorStatus` on each quote** is what the screen needs to withhold the award button before the server refuses it.

### Band position — `BR-05`, `D-39`

| Position | Where it appears |
|---|---|
| Below `bidMinPaise` | **Never reaches this endpoint.** Refused at entry in the transporter portal, never persisted |
| Within band | `bandPosition: "IN_BAND"` |
| Above `bidMaxPaise` | `bandPosition: "ABOVE_BAND"` — **kept and shown**, because it is the honest market rate on that lane and the evidence behind a recorded market gap |

`bandLocked` is `true` from publication. Bid min and max are read-only from that moment, before the first quote and after (`BR-39`).

---

## `POST /indents`

**Permission** — `indent.create` (grantable to any internal role, `BR-41`).

**Body**

```json
{
  "clientId": "c-0088", "branchId": "br-vja",
  "fromCity": "Bhiwandi", "toCity": "Hyderabad",
  "material": "CR steel coils", "weightTn": 21, "truckType": "32 ft SXL",
  "pickupDate": "2026-08-11", "transitDays": 2, "reportingRule": "SAME_DAY",
  "remarks": "Coils must be chocked.",
  "rateSource": "SPOT",
  "sellRatePaise": 4680000,
  "sourcingRatePaise": 4020000,
  "spotConfirmationAttachmentId": "att-spot-4471",
  "bidMinPaise": 3800000, "bidMaxPaise": 4250000,
  "advancePct": 40
}
```

**Errors**

| Code | Rule |
|---|---|
| `400 SPOT_CONFIRMATION_REQUIRED` | `BR-26` — a spot indent cannot be raised without the client's written rate confirmation |
| `400 SPOT_BELOW_SOURCING` | `BR-38` — a spot freight at or below the sourcing rate. Also refused by a `CHECK` constraint, so a service bug cannot bypass it |

Branch is **derived from the pickup city** and carried unchanged to the trip and the LR (`BR-20`). Transit days (`BR-27`) and remarks (`BR-28`) are captured here and carry through.

---

## `POST /indents/:id/award`

**Body** — `{ "quoteId": "q-1", "reason": "optional" }`

| Outcome | Response |
|---|---|
| In band | `200` with the updated indent. Writes `buyRatePaise` **at the moment of the decision** and a `QUOTE_AWARD` audit row carrying it (`BR-06`) |
| Above band | `202 ABOVE_BAND_PRICE`. The award executes on approval, replaying this payload verbatim |
| Vendor not `ACTIVE` | `409 VENDOR_NOT_ACTIVE` with `details.unmet` (`BR-01`) |

The buy rate is never reconstructed from a rate card afterwards. Advance, balance, margin and P&L all read that field.

Awarding also sets `advancePct` from the awarded vendor's standing policy (`BR-30`).

---

## `POST /indents/:id/placement`

**Body**

```json
{
  "vehicleNo": "MH 15 GT 4482",
  "driverName": "Sandeep Rathod",
  "driverLicence": "MH15 20180004471",
  "reportedAt": "2026-08-11T07:40",
  "transitDelay": true,
  "remarks": "Reported 90 minutes after the client's same-day requirement."
}
```

Where `reportedAt` is later than the client's reporting requirement the trip is flagged as a **transit delay in its own right**, with a remark explaining it (`BR-42`, `D-21`) — a failure to report on time is not merely a risk of a late delivery, it *is* the delay.

The frontend computes `transitDelay` for display; **the server must recompute it** and is authoritative.

---

## `POST /indents/:id/trip`

Consumes the `TRP-` series inside the creating transaction (`BR-21`, `BR-14`) and opens the trip record part 05 owns.

**Response** — `{ "id": "t-TRP-120882", "code": "TRP-120882" }` (the full trip is fine too; the frontend uses `id` and `code`).

**Errors** — `409 NOT_PLACED` unless the indent is `VEHICLE_PLACED`.

---

## `PATCH /indents/:id/advance-pct`

**Body** — `{ "advancePct": 70, "reason": "≥ 20 characters" }`
**Always `202 ADVANCE_POLICY_CHANGE`** when it departs from the awarded vendor's standing policy (`BR-57`, `D-22`).

---

## Not this side

Quote submission belongs to the transporter portal. `internal-api` reads `quotes` and awards; it never accepts a quote.

---

## Done when

- [ ] A spot indent cannot be raised without the client's written rate confirmation (`BR-26`)
- [ ] A spot freight at or below the sourcing rate is refused **by the database** (`BR-38`)
- [ ] Bid min and max are read-only after publication, quotes or no quotes (`BR-39`)
- [ ] An above-band award returns `202` and completes only after leadership approves (`BR-05`)
- [ ] Award writes `buy_rate` and an audit row in the same transaction (`BR-06`)
- [ ] A quote from a non-`ACTIVE` vendor cannot be awarded (`BR-01`)
- [ ] Branch is derived once and is identical on indent, trip and LR (`BR-20`)
- [ ] Late reporting sets the transit-delay flag and requires a remark (`BR-42`)
