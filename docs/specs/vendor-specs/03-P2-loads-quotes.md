# 03 · Loads & quotes — wave `P2`

**Depends on:** 02 · console `C2` (vendor activation, `BR-01`) and `C3` (indents, bid band, award)
**Delivers:** the screens the portal exists for — a transporter sees open loads and bids on them.
**Owns:** `BR-05`

Bottom tabs across the app: **Loads · Quotes · Trips · Fleet**. Profile sits in the header account menu — four tabs is the ceiling on a phone (`NFR-06`).

react-hook-form + zod install here. This is the first form wave.

---

## 1 · Available loads — `/portal/loads`

`GET /portal/loads?truckType=&branch=` · `portal.self` · `BR-55`

Returns open indents matching the vendor's **operating states** and **fleet types**, as `PortalLoadDTO[]` (part 02 §1). Card per load.

**Shown:** code, lane, material, weight, truck type, pickup date, transit days (`BR-27`), reporting rule (`BR-42`), branch, **bid band**, advance % (`BR-30`).

### States

| State | Presentation |
|---|---|
| Not yet quoted | "Place a quote" primary |
| Quoted | Amber pill "Quoted ₹40,800", card muted |
| Awarded to them | Mint pill "Awarded", link to the trip |
| **Filled by someone else** | **Card removed from the list** — never "you lost to a lower bid" |

The last row is `BR-55` as copy. A card that disappears tells the transporter nothing; a card that says *"filled at ₹39,800"* tells them the market rate on a lane they will bid again next week.

**Empty:** *"No loads match your fleet right now. Keep your truck availability current and new loads will appear here."*

The empty state points at part 04 deliberately — a stale fleet is the most common reason a transporter sees nothing, and blaming the platform is the default assumption.

### Reporting rule needs a sentence, not a label

`SAME_DAY` on a card is meaningless to someone reading it on a phone at a truck stop. Render it as consequence:

> **Report same day.** The client's unloading depends on it. Reporting late is recorded as a transit delay (`BR-42`).

---

## 2 · Place a quote — `/portal/loads/[code]/quote`

`POST /portal/loads/:code/quote` · `portal.self` · `BR-05`

| Field | Type | Req | Validation |
|---|---|---|---|
| Your rate | money | ● | **Below `bidMin` → rejected** (`BR-05`). Message: *"Nexraah will not award this lane below ₹38,000 — it would run at a loss for you and for the desk."* |
| Truck offered | select | ● | Own fleet, status `AVAILABLE` only |
| Remarks | textarea | ○ | |

### Band verdict — live as they type

| Rate | Verdict | Copy |
|---|---|---|
| Below `bidMin` | Blocked, red | Submit disabled |
| Within band | Mint | *"Within the band. The desk can award this to you without any approval."* |
| Above `bidMax` | Amber, **allowed** | *"Above the band. This needs Leadership approval and usually loses to an in-band quote."* |

### `BR-05` under `D-39`

FSD v2.2 closes what was open question `Q-16`. The rule now reads:

> A quote **below** the indent's bid minimum shall be rejected at entry. A quote **above** the bid maximum shall be accepted, stored, and presented to the desk marked out-of-band; awarding it requires leadership approval under `BR-40`.

So:

- **Below band** — refused at entry, `422 BELOW_BAND` with `bidMin` in the payload, **never persisted**. The transporter may retry.
- **Above band** — persisted with `band_position = 'ABOVE_BAND'`. The desk sees it flagged (console part 04); awarding it raises `202 ABOVE_BAND_PRICE` on the internal side.

Above-band quotes are kept rather than discarded because they are the honest market rate on that lane — the evidence that turns a repeated placement failure into a recorded market gap (`D-19`). A lane that only ever draws above-band quotes has a band set below the market, and refusing those quotes at entry destroys the only signal that says so.

The amber copy is honest about the odds without leaking the winning price. *"Usually loses to an in-band quote"* is true and useful; *"the current best bid is ₹39,800"* is neither permitted nor kind.

### Duplicate quotes

`409 QUOTE_EXISTS` if they already quoted. The screen shows the existing quote with a **withdraw** option rather than an error — a transporter who navigated back is not making a mistake.

---

## 3 · My quotes — `/portal/quotes`

`GET /portal/quotes?status=` · `portal.self`
`DELETE /portal/quotes/:id` — withdraw, only while `SUBMITTED`

Table: load code · lane · your rate · truck offered · submitted · status.

| Status | Colour | Extra |
|---|---|---|
| **Submitted** | Blue | Withdraw available |
| **Accepted** | Mint | Pickup date and "report by" |
| **Rejected** | Grey | — |
| **Withdrawn** | Grey | — |

**Rejected never says why.** Not "priced too high", not "another transporter was cheaper", not a rank. Any of those leaks the winning price by inference across two or three loads.

Withdrawal is allowed only while `SUBMITTED`. Once the desk has awarded, the transporter is committed — withdrawing after an award is a placement failure (`BR-18`) and belongs to a phone call, not a button.

---

## 4 · Endpoints

| Method | Path | Permission | Rules |
|---|---|---|---|
| GET | `/portal/loads?truckType=&branch=` | `portal.self` | `BR-55` |
| POST | `/portal/loads/:code/quote` | `portal.self` | `BR-05` |
| GET | `/portal/quotes?status=` | `portal.self` | |
| DELETE | `/portal/quotes/:id` | `portal.self` | Withdraw, only while `SUBMITTED` |

Rate limit: quote submission 30/hour, loads 120/hour (part 01 §4).

---

## 5 · Tests

- [ ] `GET /portal/loads` body has no `clientName`, `sellRate`, `quoteCount` at any depth (part 02 §4)
- [ ] Loads returned match only the vendor's operating states and fleet types
- [ ] A load awarded to another vendor **disappears** from the list — no "lost" state exists in the enum
- [ ] Quote below `bidMin` → `422 BELOW_BAND`, nothing written to `quotes`
- [ ] Quote above `bidMax` → `201`, row has `band_position = 'ABOVE_BAND'`
- [ ] Quote within band → `201`, `band_position = 'IN_BAND'`
- [ ] Second quote on the same load → `409 QUOTE_EXISTS`
- [ ] Truck with `DOCS_DUE` cannot be selected (part 04)
- [ ] Withdraw succeeds on `SUBMITTED`, `409` on `ACCEPTED`
- [ ] Rejected quote response carries no field naming another vendor or a winning amount
- [ ] Suspended vendor: `GET` works, `POST` returns `403 VENDOR_SUSPENDED`

---

## 6 · Done when

- [ ] Loads list, quote form and my-quotes render on a 360px viewport without horizontal scroll
- [ ] Band verdict updates live as the rate is typed, all three states
- [ ] Below-band submit is disabled **and** the server refuses it — never the client alone (`NFR-01`)
- [ ] Every test above passes
