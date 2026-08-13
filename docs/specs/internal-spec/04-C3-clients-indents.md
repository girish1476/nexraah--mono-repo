# Part 04 · Clients and indents — wave C3

| | |
|---|---|
| **Wave** | C3 |
| **Depends on** | 03 (an indent can only be awarded to an `ACTIVE` vendor) |
| **Rules owned** | `BR-05`, `BR-06`, `BR-20`, `BR-21`, `BR-26`, `BR-27`, `BR-28`, `BR-30`, `BR-38`, `BR-39`, `BR-42`, `BR-57` (indent half), `BR-01` (award block) |
| **Screens** | `/clients`, `/clients/new`, `/clients/[id]`, `/indents`, `/indents/new`, `/indents/[id]` |
| **Module** | `MOD-CLI`, `MOD-IND` · **Primary actors** `ACT-OPS`, `ACT-FIN` |

> **Purpose** (FSD B3.3): record demand, discover a price for it, and place a truck against it.

---

## 1 · Clients — `/clients`

Wizard: company → billing → agreement (spot/contract, number, validity, attachment) → credit and service. GSTIN checked against GSTN where present — advisory (part 13 §integrations).

**Rate card is read-only** — the lanes won at RFQ (`BR-37`), with rate, validity, **transit days** and **reporting rule** per lane. It is never keyed here. Spot clients show:

> *"Rates are set per indent with the client's written approval."*

Until C8 delivers RFQ, contract clients are loaded through part 12's import against a synthetic closed RFQ, which is what keeps `rate_card_lanes.rfq_lane_id NOT NULL` satisfiable.

---

## 2 · Raise an indent — `/indents/new` · `indent.create`

**Requirement:** client ● · pickup ● · delivery ● · material ● · weight ● · truck type ● · pickup date ● · **transit days** ◐ · **reporting rule** ◐ (Same day / Next day / Scheduled) · **remarks** ○ · branch derived from the pickup city and carried **unchanged** to the trip and the LR (`BR-20`).

Transit days (`BR-27`) and remarks (`BR-28`) are captured here and carry to the trip and the lorry receipt. Actual delivery is measured against the transit days.

**Pricing — contract:** freight auto-filled from the won RFQ lane. Editing above band → `ABOVE_BAND_PRICE` approval (`BR-40`).

**Pricing — spot:** sourcing rate ● · freight ● **must exceed sourcing** (`BR-38`) with live margin shown · **client rate approval attachment ●** (`BR-26`, `D-14`). Without the attachment the indent cannot be raised — enforced by the `CHECK` in part 02 §6, not only by the form.

**Placement terms:** bid min ○ · bid max ○ · advance % ● defaults from the vendor on award (`BR-30`). Setting it away from that vendor's standing policy → `ADVANCE_POLICY_CHANGE` approval (`BR-57`, `D-22`).

---

## 3 · Indent detail — `/indents/[id]`

| Panel | Contents |
|---|---|
| Progress | Raised → Quotes in → Awarded → Placed → Trip created |
| Quotes | Cheapest first: transporter · rate · **band position** · truck · submitted · **Award**. Blocked if vendor not `ACTIVE` (`BR-01`) |
| Documents | Upload/verify — gates the advance. All eight of `BR-58` listed with state, attached or not |
| **Advance** | Blocked panel until documents verify (`BR-07`). Then beneficiary (readonly) · **amount locked** (`BR-08`) · **mode ●** · transfer type ● · remitting account ● · **UTR ●** · value date ● (`BR-09`). Button rendered for **FINANCE only** (`BR-40`) |
| Placement | Record vehicle placed — captures vehicle, driver, licence, reported-at. Late reporting flags transit delay (`BR-42`). Then **Create trip** → generates `TRP-` (`BR-21`) |

The advance panel is part 07's component scoped to one record. It is rendered here; the arithmetic and the endpoint belong to C6.

### 3.1 Band position — `BR-05`, `D-39`

| Position | Presentation | Award |
|---|---|---|
| Below `bid_min` | Never reaches the desk — refused at entry in the portal, never persisted | — |
| Within band | Mint | Awards directly |
| Above `bid_max` | Amber `Out of band` pill, kept and shown | `202 ABOVE_BAND_PRICE` → leadership approves → the award then executes |

`D-39` settles what earlier drafts left ambiguous. Above-band quotes are **kept rather than refused** because they are the honest market rate on that lane — the evidence that turns a repeated placement failure into a recorded market gap (`D-19`). Refusing them outright would hide the signal.

### 3.2 The band is never widened — `BR-39`

Not before the first quote and not after. Bid min and max become read-only the moment the indent is published (`indents.band_locked`). A lane drawing no in-band quote is a market gap, and the fix is recruitment, not a wider band.

The tempting window is exactly the one where no quote has arrived yet — a rule that only locks after the first quote leaves it open.

### 3.3 Award writes the buy price — `BR-06`

Awarding a quote assigns that transporter and **writes their quoted rate onto the indent as `buy_rate`**, at the moment of the decision. Advance, balance, margin and P&L all read that field. It is never reconstructed from a rate card afterwards — FSD A9 §3 names this as the whole difficulty of holding two truths about one load.

The award writes an `audit_events` row of class `QUOTE_AWARD` carrying the `buy_rate` written.

---

## 4 · Placement and trip creation

Recording the placed vehicle captures registration, driver name, driver licence and `reported_at`. Where `reported_at` is later than the client's reporting requirement, the trip is flagged as a **transit delay in its own right** with a remark explaining it (`BR-42`, `D-21`) — a failure to report on time is not merely a late delivery risk, it is the delay.

`Create trip` consumes the `TRP-` series (`BR-21`, `BR-14`) inside the creating transaction and opens the record part 05 owns.

---

## 5 · Endpoints

```
POST   /clients · PATCH /clients/:id
GET    /clients/:id/rate-card              read-only, from rate_card_lanes

POST   /indents                            indent.create
GET    /indents?stage=&branch=&client=
GET    /indents/:id
POST   /indents/:id/award                  → 202 ABOVE_BAND_PRICE when band_position = ABOVE_BAND
POST   /indents/:id/placement              records vehicle, driver, reported_at
POST   /indents/:id/trip                   → TRP-, creates the trip
PATCH  /indents/:id/advance-pct            → 202 ADVANCE_POLICY_CHANGE (BR-57)
```

Quote submission is Spec 1's — transporters quote in the portal. This side reads `quotes` and awards.

---

## 6 · Done when

- [ ] A spot indent cannot be raised without the client's written rate confirmation (`BR-26`)
- [ ] A spot freight at or below the sourcing rate is refused by the database (`BR-38`)
- [ ] Bid min and max are read-only after publication, quotes or no quotes (`BR-39`)
- [ ] An above-band award returns `202`, and completes only after leadership approves (`BR-05`, `D-39`)
- [ ] Award writes `buy_rate` and an audit row in the same transaction (`BR-06`)
- [ ] A quote from a non-`ACTIVE` vendor cannot be awarded (`BR-01`)
- [ ] Branch is derived once from the pickup city and is identical on indent, trip and LR (`BR-20`)
- [ ] Late reporting sets the transit-delay flag and requires a remark (`BR-42`)
- [ ] Advance % away from the vendor standard returns `202` (`BR-57`)

**Tests** (part 13 §23): 7, 8, 9, 14.
