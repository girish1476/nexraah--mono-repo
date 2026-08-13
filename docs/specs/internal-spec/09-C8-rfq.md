# Part 09 · RFQ and rate management — wave C8

| | |
|---|---|
| **Wave** | C8 — new, highest design risk, but not on the critical path |
| **Depends on** | 04 (clients) |
| **Rules owned** | `BR-36`, `BR-37`, `BR-38` (RFQ half), `BR-39` (market gap half) |
| **Screens** | `/rfq`, `/rfq/new`, `/rfq/[id]`, `/rfq/[id]/lanes/[laneId]/sourcing`, `/rfq/[id]/lanes/[laneId]/quote`, `/rfq/[id]/award` |
| **Module** | `MOD-RFQ` · **Actors** `ACT-OPS` supplies sourcing rates, `LEADERSHIP` submits |

> **Purpose** (FSD B3.9): win lanes at a price that can be served profitably. Entirely new — no prototype precedent. `D-18`.

---

## 1 · Flow

```
RFQ received → sourcing rates (ops) → quote build-up → submit → award → rate cards
```

| Screen | Detail |
|---|---|
| **List** `/rfq` | Stats: open RFQs · lanes out to bid · lanes won · lost · win rate · value won. Statuses Draft → Sourcing → Quoted → Submitted → Awarded/Lost → Closed |
| **New** `/rfq/new` | Client ● · cycle ● (3/6/12 months) · period from ● · period to (derived) · submission due ● · reference ○ |
| **Lanes** `/rfq/[id]` | Inline table: origin → destination · truck type · sourcing mode · sourcing avg · overhead · margin · quoted rate · outcome. Add lane captures transit days and reporting rule |
| **Sourcing** `/rfq/[id]/lanes/[laneId]/sourcing` | **Monthly:** a rate per month across the period, average computed. **High/low:** two fields, midpoint. Ops supplies it |
| **Quote build-up** `/rfq/[id]/lanes/[laneId]/quote` | `average sourcing + overhead + margin = quoted rate`, with a stacked bar showing proportions. Quoted rate not directly editable (`BR-36`). Warn below minimum margin %. Bulk-apply overhead and margin across lanes |
| **Award** `/rfq/[id]/award` | Per lane Won/Lost/Withdrawn with awarded rate. **Create rate cards** shows exactly what will be created before writing (`BR-37`) |

---

## 2 · The quote build-up — `BR-36`

```
average sourcing rate + overheads + margin = the rate quoted
```

**The quoted rate is derived, never keyed.** Each component is stored against the lane so a won lane can later be tested against what it actually cost (`R-03`) — a soft sourcing rate wins a lane that cannot be served, and the only way to find that out is to compare the stored component against the placement rates the lane actually draws.

Transit days and the vehicle reporting requirement are captured per lane here, because they are client requirements that must reach the indent and the LR (`BR-27`, `D-21`) — a lane won without them produces indents that cannot be measured.

Warn when margin falls below `config.minimum_margin_pct`.

---

## 3 · Award and rate cards — `BR-37`

The client awards each lane to the lowest bid. Won lanes are recorded with their validity and **become the client's rate card entry for the RFQ validity period without separate re-entry**.

`Create rate cards` renders exactly what will be written before writing it. Every `rate_card_lanes` row carries `rfq_lane_id NOT NULL` (part 02 §3) — a rate card line with no RFQ provenance cannot exist, which is `BR-37` enforced by the schema rather than by a service.

Part 04's client rate card screen is read-only against these rows.

---

## 4 · Spot and the market gap

**Spot sits outside any RFQ.** Operations supplies the sourcing rate of the day and the quote is built from it. **A spot load shall never be quoted at a loss** (`BR-38`, `D-20`) — enforced at the indent (part 04) by the `CHECK` in part 02 §6.

Where no transporter quotes inside the band on a lane, **the band is not widened** to force a placement (`BR-39`). The shortfall is recorded as a **market gap** (part 03 §3) and drives lead generation; for lanes being bid at RFQ, the vendor base is built **before** the bid rather than after (`D-19`).

This is the commercial half of the rule part 04 enforces mechanically: winning a lane you cannot source is a placement failure every week for the life of the contract.

---

## 5 · Endpoints

```
POST  /rfqs · /rfqs/:id/lanes
PATCH /rfqs/:id/lanes/:laneId/sourcing · /buildup
POST  /rfqs/:id/submit      rfq.submit — LEADERSHIP, fixed
POST  /rfqs/:id/award       → rate_card_lanes
GET   /rfqs?status=&client=
GET   /rfqs/:id
```

`rfq.submit` is fixed to `LEADERSHIP` (part 01 §2.4). Operations and branch managers supply sourcing rates and build the quote; only leadership may submit it (FSD B2 note).

---

## 6 · Done when

- [ ] Quoted rate cannot be typed — only sourcing, overhead and margin are editable (`BR-36`)
- [ ] All three components persist per lane and survive award (`BR-36`, `R-03`)
- [ ] Margin below the configured minimum warns, and the warning is dismissible but recorded
- [ ] Award writes rate card lanes, each with its `rfq_lane_id`, and the preview matches what is written (`BR-37`)
- [ ] A rate card lane cannot be created by any other route
- [ ] Only `LEADERSHIP` can submit; every other role gets `403`
- [ ] Sourcing supports both monthly rows and high/low with a computed midpoint
