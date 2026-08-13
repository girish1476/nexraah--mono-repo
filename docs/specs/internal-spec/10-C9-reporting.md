# Part 10 · Reporting — wave C9

| | |
|---|---|
| **Wave** | C9 |
| **Depends on** | 07 (margin needs both a buy rate and released payments) |
| **Rules owned** | `BR-18`, `BR-35` |
| **Screens** | `/today`, `/home`, `/pnl`, `/print/pnl` |
| **Module** | `MOD-PNL` plus the two working views |

---

## 1 · Today — `/today` · `indent.view`

`GET /reports/today`. Three working queues, nothing else. **Not a dashboard** — every panel is a list of things someone must act on today.

### 1.1 Trips pending allocation

Indents at `OPEN`, earliest pickup first.

**Stats:** waiting · freight at stake · no quotes yet · quotes in · earliest pickup · tonnes
**Charts:** donut by truck type · bars by branch
**Table:** indent (link) · client · lane · load · truck type · pickup · freight · quotes · branch

### 1.2 Placement failures — `BR-18`

`stage IN (OPEN, VENDOR_ASSIGNED) AND pickup_date < today`

**Stats:** failed · freight lost · worst branch · longest overdue · never quoted · truck no-show

**Causes:** No quote at all · **Only above-band quotes** · Quotes in band, none awarded · Truck never reported · Client cancelled

*Only above-band quotes* is a distinct cause because under `D-39` those quotes are kept rather than discarded. A lane that repeatedly draws nothing but above-band quotes has a band set below the market — which is precisely the market-gap signal `D-19` depends on, and it is invisible if the quotes are refused at entry.

**Links to** Market gap (part 03 §3) — a repeat failure on a lane is a recruitment problem, not a pricing licence (`BR-39`).

The nightly `placement-failure` job (part 13) writes `indents.failure_cause`; this screen reads it.

### 1.3 Vendor issues

Open issues only. Donut by category, bars by transporter, list by severity.

---

## 2 · Home — `/home`

`GET /reports/home?month=` · reporting, not operations. Leadership and branch managers land here.

**Block M — This month.** Month selector. Trips · revenue · transporter cost · gross margin · margin % · vendors used. Daily revenue columns. Revenue-share donut, top five clients. Placement panel: on-time % (mint ≥ 90, amber ≥ 70, red below), placed by pickup date, failures, vendors utilised, distinct trucks, top six destinations. Branch table with share gauge.

**Block P — POD collection.** Delivered · collected · pending · within TAT · breached · collection %. Status donut, pending-by-transporter bars, breached table with penalty accrued.

**Block S — Where things stand.** Standing totals.

---

## 3 · P&L — `/pnl`

`BR-35`, `D-05`. Granularity Daily · Monthly · Quarterly. Branch and range filters.

**Revenue** is the customer rate billed for the consignment. **Cost is the placement rate paid to the transporter plus every other cost the company incurs on that load** — loading, unloading, detention, halt, labour and any other charge booked against it. The flat monthly branch overhead used in the prototype is withdrawn; **no assumed percentage, no blanket allocation.**

```
Placement rate (to transporters)   ₹28,40,000
Loading · Unloading · Detention     ₹ 2,80,000
Other                               ₹   18,000
Total cost                         ₹31,38,000
Customer rate                      ₹36,90,000
Margin                             ₹ 5,52,000   (15.0%)
```

**Exception panel:** trips closed with no charges captured. Those overstate margin and nothing else will tell you (`R-01`). The weekly `charge-capture-exception` job (part 13) populates it.

Because cost is built from actual charge lines rather than an assumed percentage, **the margin figure is only as good as the charge capture on each trip** — which is why charges are entered against the load at POD verification (part 05 §4, part 06 §3) and not at month end.

Trend chart · branch table · CSV export · A4 print at `/print/pnl`.

---

## 4 · Branch scoping

`BRANCH_MGR` sees only their own branch in the P&L and in Today (FSD B2: *View own branch*). Scoping is applied at the repository layer, never in a controller and never in the frontend (part 01 §2.5). The test asserts the endpoint, not the screen.

---

## 5 · Endpoints

```
GET /reports/today                       indent.view
GET /reports/home?month=
GET /pnl?granularity=&from=&to=&branch=
GET /pnl/exceptions                      trips closed with no charges
GET /pnl/export.csv                      honours filters
GET /print/pnl                           A4 statement
```

---

## 6 · Done when

- [ ] Today shows three queues and no vanity metrics
- [ ] Every placement failure carries one of the five causes, including *only above-band quotes* (`BR-18`, `D-39`)
- [ ] P&L cost is the sum of `buy_rate` and every `trip_charges.cost_amount` — no percentage anywhere in the query (`BR-35`)
- [ ] The exception panel lists every closed trip with zero charge rows (`R-01`)
- [ ] A branch manager's P&L request returns only their branch, tested at the endpoint
- [ ] CSV export honours the active filters
