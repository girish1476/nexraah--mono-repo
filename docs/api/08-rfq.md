# 08 · RFQ and rate management — wave C8

Win lanes at a price that can be served profitably.

Frontend: `src/app/rfq/apis.ts` · `src/app/rfq/types.ts`

---

## `GET /rfqs`

**Query** — `status`, `client`.

```json
{
  "stats": { "open": 1, "lanesOut": 3, "lanesWon": 0, "lanesLost": 0, "valueWonPaise": 0 },
  "rows": [{
    "id": "rfq-1", "clientName": "Berger Paints", "reference": "BRG/RFQ/27",
    "cycleMonths": 12, "periodFrom": "2027-04-01", "periodTo": "2028-03-31",
    "dueAt": "…", "status": "SOURCING", "laneCount": 2
  }]
}
```

`status` ∈ `DRAFT · SOURCING · QUOTED · SUBMITTED · AWARDED · LOST · CLOSED`.

---

## `GET /rfqs/:id`

```json
{
  "id": "rfq-1", "clientId": "c-0092", "clientName": "Berger Paints",
  "cycleMonths": 12, "periodFrom": "2027-04-01", "periodTo": "2028-03-31",
  "dueAt": "…", "reference": "BRG/RFQ/27", "status": "SOURCING",
  "submittedBy": null, "submittedAt": null,
  "lanes": [{
    "id": "rl-11",
    "origin": "Kolkata", "destination": "Nashik", "truckType": "32 ft SXL",
    "transitDays": 5, "reportingRule": "NEXT_DAY",
    "sourcingMode": "MONTHLY",
    "sourcingRows": [
      { "month": "2026-03", "ratePaise": 5620000 },
      { "month": "2026-04", "ratePaise": 5710000 },
      { "month": "2026-05", "ratePaise": 5840000 }
    ],
    "sourcingAvgPaise": 5723333,
    "overheadPaise": 210000,
    "marginPaise": 480000,
    "quotedRatePaise": 6413333,
    "outcome": null,
    "awardedRatePaise": null
  }]
}
```

`sourcingMode` ∈ `MONTHLY · HIGH_LOW`. For `HIGH_LOW` there are exactly two rows with `month: null` and the server takes the **midpoint**.

---

## `POST /rfqs` · `POST /rfqs/:id/lanes`

```json
// POST /rfqs
{ "clientId": "c-0092", "cycleMonths": 12,
  "periodFrom": "2027-04-01", "periodTo": "2028-03-31",
  "dueAt": "2027-02-20", "reference": "BRG/RFQ/27" }

// POST /rfqs/:id/lanes
{ "origin": "Kolkata", "destination": "Nashik", "truckType": "32 ft SXL",
  "transitDays": 5, "reportingRule": "NEXT_DAY" }
```

Transit days and the reporting rule are captured **per lane, here**, because they are client requirements that must reach the indent and the LR (`BR-27`, `D-21`). A lane won without them produces indents that cannot be measured.

---

## `PATCH /rfqs/:id/lanes/:laneId/sourcing`

```json
{ "sourcingMode": "MONTHLY",
  "sourcingRows": [{ "month": "2026-03", "ratePaise": 5620000 }] }
```

The server computes `sourcingAvgPaise` and refreshes `quotedRatePaise`. **The browser never sends an average.**

## `PATCH /rfqs/:id/lanes/:laneId/buildup`

```json
{ "overheadPaise": 210000, "marginPaise": 480000 }
```

```
average sourcing rate + overhead + margin = the rate quoted
```

**The quoted rate is derived and is never sent, never keyed** (`BR-36`). Each component persists against the lane so a won lane can later be tested against the placement rates it actually draws — a soft sourcing rate wins a lane that cannot be served, and comparison is the only way to find out (`R-03`).

Warn when the margin falls below `config.minimum_margin_pct`. The warning is dismissible **and recorded**.

---

## `POST /rfqs/:id/submit`

**Permission** — `rfq.submit`, fixed to `LEADERSHIP`. Every other role gets `403`.

Operations and branch managers supply sourcing rates and build the quote; only leadership submits it.

---

## `POST /rfqs/:id/award`

```json
{ "lanes": [
  { "laneId": "rl-11", "outcome": "WON",  "awardedRatePaise": 6420000 },
  { "laneId": "rl-12", "outcome": "LOST" }
]}
```

`outcome` ∈ `WON · LOST · WITHDRAWN`.

**Response — exactly what was written:**

```json
{
  "rfqId": "rfq-1",
  "status": "AWARDED",
  "rateCardLanesCreated": [{
    "id": "rc-9", "rfqLaneId": "rl-11",
    "origin": "Kolkata", "destination": "Nashik", "truckType": "32 ft SXL",
    "ratePaise": 6420000, "validFrom": "2027-04-01", "validTo": "2028-03-31"
  }]
}
```

Won lanes **become the client's rate card entry for the RFQ validity period without separate re-entry** (`BR-37`). The award screen previews these rows before writing, and the preview must match this response.

Every `rate_card_lanes` row carries `rfq_lane_id NOT NULL` — `BR-37` enforced by the schema rather than by a service, which is also why part 12 imports rate cards against a synthetic closed RFQ.

---

## Spot sits outside any RFQ

Operations supplies the sourcing rate of the day and the quote is built from it at the indent. **A spot load is never quoted at a loss** (`BR-38`, `D-20`) — enforced by the `CHECK` constraint, not by this module.

Where no transporter quotes inside the band on a lane, **the band is not widened** (`BR-39`). The shortfall is recorded as a market gap and drives lead generation; for lanes being bid at RFQ the vendor base is built **before** the bid rather than after (`D-19`).

---

## Done when

- [ ] The quoted rate cannot be typed — only sourcing, overhead and margin are editable (`BR-36`)
- [ ] All three components persist per lane and survive award (`R-03`)
- [ ] Margin below the configured minimum warns, and the warning is recorded
- [ ] Award writes rate card lanes each with their `rfqLaneId`, and the preview matches what is written (`BR-37`)
- [ ] A rate card lane cannot be created by any other route
- [ ] Only `LEADERSHIP` can submit; every other role gets `403`
- [ ] Sourcing supports both monthly rows and high/low with a computed midpoint
