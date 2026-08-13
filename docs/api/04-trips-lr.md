# 04 · Trips and the lorry receipt — wave C4

Frontend: `src/app/trips/apis.ts` · `src/app/trips/types.ts`

---

## `GET /trips`

**Query** — `q`, `field`, `stage`, `branch`, `transporter`, `pod_status`.

`q` searches across trip code, LR code, indent code, vehicle number, transporter, client and branch. `field` narrows it to one of those; absent means all.

```json
[{
  "id": "t-120881", "code": "TRP-120881", "lrCode": "LR-88214", "indentCode": "IND-4443",
  "clientName": "Berger Paints", "vendorName": "Rathod Roadlines", "branchName": "Nashik",
  "lane": "Nashik → Kolkata", "vehicleNo": "MH 15 GT 4482",
  "stage": "DELIVERED", "podStatus": "PENDING", "deliveredAt": "…",
  "buyRatePaise": 5840000, "sellRatePaise": 6420000,
  "advancePaidPaise": 0, "podPenaltyPaise": 40000
}]
```

`stage` ∈ `OPEN · IN_TRANSIT · DELIVERED · CLOSED`.
`podStatus` ∈ `PENDING · ATTACHED · RECEIVED · VERIFIED · APPROVED · WAIVED · FORFEITED`.

---

## `GET /trips/:id`

The list row plus:

```json
{
  "indentId": "i-4443",
  "vehicleType": "32 ft SXL", "capacityTn": 21, "weightTn": 19, "distanceKm": 1912,
  "driverName": "Sandeep Rathod", "driverLicence": "MH15 20180004471", "driverPhone": "9822014479",
  "transitDaysRequired": 5, "actualTransitDays": 6, "transitDelay": true,
  "remarks": "Stack no more than three high.",
  "advancePct": 40,
  "ewayNo": null, "ewayValidTill": null,
  "podReceivedAt": null, "podClosureBasis": null,
  "balancePaidPaise": 0, "billed": false,
  "documents": [ /* below */ ],
  "charges": [ /* below */ ],
  "lr": { /* below, or null */ }
}
```

Transit days required comes from the indent (`BR-27`); actual is measured against it. Remarks carry indent → trip → LR (`BR-28`).

---

## Documents — part 05 §3

```
GET  /trips/:id/documents
POST /trips/:id/documents/:kind            { attachmentId?, keyedValues? }
POST /trips/:id/documents/:kind/verify     document.verify
POST /trips/:id/documents/:kind/reject     { reason }
```

**Document**

```json
{
  "kind": "EWAY_BILL",
  "label": "E-way bill",
  "group": "CLIENT",
  "gatesAdvance": true,
  "status": "MISSING",
  "attachmentId": null,
  "uploadedAt": null,
  "verifiedBy": null,
  "verifiedAt": null,
  "rejectReason": null,
  "keyedValues": { "ewayNo": "", "vehicleNo": "", "validTill": "" }
}
```

Eleven documents in five groups:

| `group` | `kind` | Gates the advance |
|---|---|---|
| `CLIENT` | `CLIENT_INVOICE_OR_PO`, `EWAY_BILL` | both |
| `VEHICLE` | `RC`, `INSURANCE`, `FITNESS`, `PERMIT`, `PUC` | all five |
| `DRIVER` | `DRIVING_LICENCE` | yes |
| `LR` | `LR` | no — issued after placement |
| `POD` | `POD` | no — gates the balance |

`gatesAdvance` must be computed from `config.advance_document_set`, **not hard-coded**. Removing a member there is an audited configuration change that releases money previously held.

`status` ∈ `MISSING · PENDING · VERIFIED · REJECTED`. Verification is by whoever holds `document.verify` (`BR-41`), and every verify and reject writes a `DOC_VERIFY` audit row. A reject with no reason is `400`.

`keyedValues` is what the uploader typed off the document. It feeds the cross-check until NIC and OCR are connected; once NIC is live the e-way side stops being keyed and the check becomes authoritative rather than typo-prone.

---

## `GET /trips/:id/cross-check` — `BR-32`, `D-09`

Runs when the client invoice, the e-way bill and the lorry receipt are all present.

**Not yet runnable**

```json
{ "runnable": false, "waitingOn": ["E-way bill", "Lorry receipt"], "mismatches": [], "overridden": false }
```

**Runnable**

```json
{
  "runnable": true,
  "waitingOn": [],
  "overridden": false,
  "mismatches": [{
    "field": "Vehicle number",
    "a": { "source": "E-way bill", "value": "MH15GT4428" },
    "b": { "source": "Lorry receipt", "value": "MH 15 GT 4482" }
  }]
}
```

Compared: invoice number and value (client invoice ↔ LR), vehicle number (e-way ↔ LR), consignor GSTIN and consignee (client invoice ↔ LR), e-way validity (≥ expected delivery).

**While any mismatch is open and unoverridden, `POST /trips/:id/lr/generate` and the placement-complete action must be refused.** These errors are penalised at a checkpost, so catching them after dispatch catches nothing.

## `POST /trips/:id/cross-check/override`

**Body** — `{ "reason": "≥ 20 characters" }` → **`202 DOC_OVERRIDE`**, approver senior to ops (`BR-44`, `D-28`). `400 REASON_TOO_SHORT` below 20. Writes an `OVERRIDE` audit row on approval.

---

## Charges — part 05 §4

```
GET  /trips/:id/charges
POST /trips/:id/charges     { chargeType, costAmountPaise, billedAmountPaise }
```

```json
{
  "id": "ch-1", "chargeType": "LOADING",
  "costAmountPaise": 180000, "billedAmountPaise": 220000,
  "capturedBy": "Anil Deshmukh", "capturedAt": "…"
}
```

`chargeType` ∈ `LOADING · UNLOADING · LABOUR · HALT · DETENTION · OTHER`.

**Cost and billed are separate columns** so the mark-up is visible in the margin (`BR-45`). A billed figure below cost is a warning, not a refusal.

Charges are normally captured **at POD verification** (`BR-56`) — `POST /pod/:tripId/verify` accepts the same rows. This endpoint exists for corrections and for the standalone tab.

Trips closed with no charges appear in `GET /pnl/exceptions` and in the weekly `charge-capture-exception` job (`R-01`).

---

## Lorry receipt — part 05 §5

```
GET   /trips/:id/lr
PATCH /trips/:id/lr           draft autosave, every 3 seconds
POST  /trips/:id/lr/generate  BR-13, BR-14 → consumes LR-
POST  /trips/:id/lr/share     optional, BR-22
```

```json
{
  "code": "LR-88214",
  "status": "IN_TRANSIT",
  "lrDate": "…", "bookedAt": "…", "sharedAt": null,
  "consignor": { "name": "Berger Paints", "address": "MIDC Satpur, Nashik", "gstin": "27AAACB2545C1Z9" },
  "consignee": { "name": "Berger Paints Depot", "address": "Dum Dum, Kolkata", "gstin": "19AAACB2545C1Z9" },
  "goods": { "description": "Paint drums", "packages": 420, "weightTn": 19, "valuePaise": 1840000 },
  "invoice": { "number": "SM/26/1189", "datedOn": "…", "valuePaise": 1840000 },
  "eway": { "number": "", "validTill": "" },
  "vehicle": { "registration": "MH 15 GT 4482", "type": "32 ft SXL" },
  "driver": { "name": "Sandeep Rathod", "licence": "MH15 20180004471", "phone": "9822014479" },
  "transitDays": 5,
  "remarks": "Stack no more than three high.",
  "chargeHeads": {
    "freightPaise": 6420000, "loadingPaise": 220000, "unloadingPaise": 0,
    "detentionPaise": 0, "otherPaise": 0, "discountPaise": 0
  }
}
```

`GET` returns `null` before a draft exists; the screen then seeds one from the trip.
`status` ∈ `DRAFT · BOOKED · RELEASED · IN_TRANSIT · DELIVERED`.

**One record per trip** — `lorry_receipts.trip_id` is unique (`BR-22`). The LR and the E-LR are the same document, held once, never two rows.

### `POST /trips/:id/lr/generate`

| Error | Rule |
|---|---|
| `409 NOT_PLACED` | `BR-13` — no LR before the truck is placed |
| `409 LR_EXISTS` | `BR-22` — the unique constraint proves it |
| `409` on an open cross-check mismatch | `BR-32` |

Consumes the number inside the issuing transaction (`BR-14`) and opens the trip.

### `POST /trips/:id/lr/share`

Sets `sharedAt`. **Optional, always** — sharing is used where the transporter or consignee asks for it and is never required to move the trip forward. The `lr.released` notification fires only where sharing was requested.

---

## Print

`/print/lr/[tripId]` is a portal route, not an API call. It reads `GET /trips/:id` and `GET /config` and renders A4 with the company GSTIN, PAN and CIN, a Code 39 barcode of the LR number and three signature blocks — consignor, carrier, consignee. **The printed copy is the primary form.**

---

## Done when

- [ ] `Generate LR` refuses before the truck is placed (`BR-13`)
- [ ] A second LR cannot be created for a trip (`BR-22`)
- [ ] Sharing is never required to move the trip forward (`BR-22`)
- [ ] All eleven documents return with state; the eight of `BR-58` carry `gatesAdvance: true` **from config**
- [ ] An open cross-check mismatch blocks LR generation until rejected or overridden (`BR-32`)
- [ ] An override under 20 characters is refused; over 20 raises `DOC_OVERRIDE` and audits (`BR-44`)
- [ ] Charge rows carry cost and billed separately (`BR-45`)
