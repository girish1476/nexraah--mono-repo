# 09 · Reporting — wave C9

Frontend: `src/app/today/apis.ts` · `src/app/home/apis.ts` · `src/app/pnl/apis.ts`

**Branch scoping.** `BRANCH_MGR` sees only their own branch in Today, Home and the P&L. Scoping is applied **at the repository layer**, never in a controller and never in the frontend. No call here passes a branch filter for that purpose, and the test asserts the endpoint, not the screen.

---

## `GET /reports/today` · `indent.view`

Three working queues and nothing else. **Not a dashboard** — every panel is a list of things someone must act on today.

```json
{
  "pendingAllocation": {
    "stats": {
      "waiting": 3, "freightAtStakePaise": 14790000,
      "noQuotes": 1, "quotesIn": 4,
      "earliestPickup": "2026-08-11T00:00:00.000Z", "tonnes": 60
    },
    "rows": [{
      "id": "i-4471", "code": "IND-4471", "clientName": "Sanghvi Metals",
      "lane": "Bhiwandi → Hyderabad", "weightTn": 21, "truckType": "32 ft SXL",
      "pickupDate": "…", "sellRatePaise": 4680000, "quoteCount": 3, "branchName": "Vijayawada"
    }]
  },
  "placementFailures": {
    "stats": { "failed": 1, "freightLostPaise": 3900000, "neverQuoted": 0 },
    "rows": [{
      "id": "i-4468", "code": "IND-4468", "clientName": "Berger Paints",
      "lane": "Chakan → Coimbatore", "pickupDate": "…", "branchName": "Pune",
      "cause": "ONLY_ABOVE_BAND_QUOTES", "sellRatePaise": 3900000
    }]
  },
  "vendorIssues": { "rows": [ /* Issue, see 02-vendors */ ] },
  "podOverdue": {
    "rows": [{
      "tripId": "t-120881", "tripCode": "TRP-120881", "lane": "Nashik → Kolkata",
      "vendorName": "Rathod Roadlines", "ageDays": 24, "balanceHeldPaise": 5840000
    }]
  }
}
```

**Pending allocation** — indents at `OPEN`, earliest pickup first.

**Placement failures** — `stage IN (OPEN, VENDOR_ASSIGNED) AND pickup_date < today`. `cause` is one of five (`BR-18`):

| `cause` | Note |
|---|---|
| `NO_QUOTE_AT_ALL` | |
| `ONLY_ABOVE_BAND_QUOTES` | **A distinct cause**, and the reason above-band quotes are kept rather than discarded (`D-39`). A lane that repeatedly draws nothing else has a band set below the market — the market-gap signal `D-19` depends on, invisible if those quotes were refused at entry |
| `IN_BAND_NONE_AWARDED` | |
| `TRUCK_NEVER_REPORTED` | |
| `CLIENT_CANCELLED` | |

The nightly `placement-failure` job writes `indents.failure_cause`; this endpoint reads it. It is never computed at request time.

---

## `GET /reports/home?month=YYYY-MM`

Reporting, not operations. Leadership and branch managers land here.

```json
{
  "month": {
    "trips": 1561, "revenuePaise": 7504000000, "costPaise": 6462000000,
    "marginPaise": 1042000000, "vendorsUsed": 38,
    "onTimePct": 91.4, "placedByPickup": 1489, "failures": 72, "distinctTrucks": 412
  },
  "branches": [{ "branchName": "Nashik", "trips": 412,
                 "revenuePaise": 1864000000, "costPaise": 1598000000 }],
  "topClients": [{ "clientName": "Berger Paints", "revenuePaise": 2140000000 }],
  "pod": {
    "delivered": 1488, "collected": 1351, "pending": 3,
    "withinTat": 1288, "breached": 63,
    "collectionPct": 90.8, "penaltyAccruedPaise": 630000
  },
  "standing": {
    "advanceOutstandingPaise": 18400000, "balancePendingPaise": 31700000,
    "receivablesPaise": 145200000, "unbilledTrips": 41
  }
}
```

Three blocks: **M** this month, **P** POD collection, **S** where things stand. On-time percentage is mint ≥ 90, amber ≥ 70, red below — the thresholds are presentation and live in the screen.

---

## `GET /pnl` — `BR-35`, `D-05`

**Query** — `granularity` (`DAILY · MONTHLY · QUARTERLY`), `from`, `to`, `branch`.

```json
{
  "scope": "Nashik only · pnl.view_all not granted",
  "rows": [{
    "period": "Nashik",
    "placementPaise": 1418000000,
    "loadingPaise": 92000000,
    "unloadingPaise": 61000000,
    "detentionPaise": 21000000,
    "otherPaise": 6000000,
    "costPaise": 1598000000,
    "revenuePaise": 1864000000,
    "marginPaise": 266000000
  }]
}
```

`scope` is a human-readable string the screen prints under the title, so a branch manager can see what they are and are not looking at.

**Revenue** is the customer rate billed for the consignment. **Cost is the placement rate paid to the transporter plus every other cost the company incurs on that load** — loading, unloading, detention, halt, labour and any other charge booked against it.

> The flat monthly branch overhead used in the prototype is **withdrawn**. No assumed percentage, no blanket allocation. There must be no percentage anywhere in this query.

Because cost is built from actual charge lines, the margin figure is only as good as the charge capture on each trip — which is why charges are entered against the load at POD verification and not at month end.

## `GET /pnl/exceptions`

Trips closed with **no charges captured**. They overstate margin and nothing else will tell you (`R-01`). The weekly `charge-capture-exception` job populates it.

```json
[{
  "tripId": "t-120874", "tripCode": "TRP-120874",
  "lane": "Pune → Surat", "vendorName": "Sai Kripa Carriers", "branchName": "Pune",
  "deliveredAt": "…", "buyRatePaise": 1860000
}]
```

## `GET /pnl/export.csv`

Honours the active filters. Linked with a bare `<a href>` — see conventions §9.

---

## Done when

- [ ] Today returns three queues and no vanity metrics
- [ ] Every placement failure carries one of the five causes, including *only above-band quotes* (`BR-18`, `D-39`)
- [ ] P&L cost is the sum of `buy_rate` and every `trip_charges.cost_amount` — no percentage anywhere in the query (`BR-35`)
- [ ] The exception endpoint lists every closed trip with zero charge rows (`R-01`)
- [ ] A branch manager's P&L request returns only their branch, tested at the endpoint
- [ ] CSV export honours the active filters
