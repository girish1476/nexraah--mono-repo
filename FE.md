# FE.md — API contracts the vendor portal expects

The vendor frontend is built first. Every screen that needs data records its request and
response shape here, and `vendor-api` is built to match. **This file is the contract.** If
the backend must deviate, change this file in the same commit and fix the FE types.

- Base URL: `http://localhost:4001/api/v1` (global prefix, root `README.md`).
- Every response is wrapped by the vendor-api transform interceptor: `{ "success": true, "data": <payload> }`. Shapes below describe `data` only.
- **Money is `bigint` paise** everywhere on the wire (`NFR-09`). `₹` formatting is FE-only (`src/lib/format.ts`).
- Timestamps are ISO 8601 with offset (`2026-08-11T06:00:00+05:30`).
- Auth: `Authorization: Bearer <token>`, attached by `src/apis.ts`. 401 clears the token.
- **Redaction (part 02 · `BR-55` · `NFR-02` · `D-38`):** no `clientId`, `clientName`, `sellRate`, `quoteCount`, `otherQuotes`, `margin`, `sourcingRate`, `branchTarget`, or anything about another vendor — **at any depth**. Another vendor's record returns **404, not 403**.
- Until an endpoint exists, the FE serves fixtures shaped exactly like these payloads (`NEXT_PUBLIC_MOCK=1`, `src/lib/mock.ts`).

Status legend: **live** = FE calls it · **spec'd** = in `docs/specs/vendor-specs/11-cross-cutting.md` · **new** = FE needs it, not yet in the spec index — decide before building.

---

## 1. Loads — `apps/vendor-portal/src/app/loads/`

### `GET /portal/loads` — spec'd (part 03)

Screen: Available loads. Query: `truckType` (comma-separated, optional), `branch` (optional).

```jsonc
// data: Load[]
[
  {
    "code": "LD-4471",
    "originCity": "Bhiwandi",
    "destinationCity": "Hyderabad",
    "truckType": "32 ft SXL",          // enum: 32 ft SXL | 22 ft container | 40 ft trailer | Open body
    "weightKg": 21000,
    "goods": "CR steel coils",
    "distanceKm": 712,
    "transitDays": 2,                   // BR-27
    "reportingRule": "SAME_DAY",       // SAME_DAY | NEXT_DAY | SCHEDULED — BR-42
    "remarks": "Reporting 06:00 at the plant gate",  // BR-28, nullable
    "pickupAt": "2026-08-11T06:00:00+05:30",
    "bandLowPaise": 3800000,
    "bandHighPaise": 4250000,
    "advancePct": 40,                   // BR-30
    "myQuote": null                     // or { "id", "status": "SUBMITTED"|"PENDING_APPROVAL", "amountPaise" }
  }
]
```

Rate limit per spec: 120/hour, log outliers (scripting this endpoint watches our pricing).

### `GET /portal/loads/:code` — **new**

Screen: Load detail, and it is the deep-link/refresh path for the quote form. Same object as
one array element above. Not in the spec's endpoint index — either add it, or the FE must
carry list state into the detail screen (worse: a refresh loses the load).

`404` when the code is unknown **or not offered to this vendor** — never 403.

### `POST /portal/loads/:code/quote` — spec'd (part 03 · `BR-05`)

Screen: Place a quote.

```jsonc
// request
{ "amountPaise": 4020000, "vehicleId": "VH-9034", "reportingRule": "SAME_DAY" }

// data (201)
{
  "id": "QT-8841",
  "loadCode": "LD-4471",
  "amountPaise": 4020000,
  "status": "SUBMITTED",   // above band → "PENDING_APPROVAL"
  "aboveBand": false
}
```

Errors:

| Code | When | FE shows |
|---|---|---|
| `422 QUOTE_BELOW_BAND` | `amountPaise < bandLowPaise` | "Nexraah will not award this lane below ₹X…" — the FE also blocks the button, the API is the authority |
| `409 QUOTE_EXISTS` | vendor already quoted this load | Send them to My quotes |
| `409 LOAD_CLOSED` | indent awarded/cancelled | Refresh the list |
| `422 VEHICLE_UNAVAILABLE` | vehicle on trip / `DOCS_DUE` | "Free one up under Fleet" |
| `429` | 30 quotes/hour per vendor | Retry-after copy |

The error body must **never** carry a competing price or a quote count as a reason.

### `GET /portal/fleet?availability=AVAILABLE` — spec'd (part 04), subset used early

The quote form needs something to quote with. It reads only:

```jsonc
[{ "id": "VH-9034", "registrationNo": "MH 04 KL 9034", "truckType": "22 ft container", "capacityKg": 9000 }]
```

Full fleet record lands with the Fleet screen (wave P3).

---

## 2. My quotes — `apps/vendor-portal/src/app/quotes/`

### `GET /portal/quotes` — spec'd (part 03)

Query: `status` (comma-separated, optional). FE filters: All → none · Open → `SUBMITTED,PENDING_APPROVAL` · Won → `WON` · Lost → `LOST`.

```jsonc
// data: Quote[]
[
  {
    "id": "QT-8802",
    "loadCode": "LD-4443",
    "originCity": "Nashik",
    "destinationCity": "Kolkata",
    "amountPaise": 5840000,
    "status": "WON",                 // SUBMITTED | PENDING_APPROVAL | WON | LOST | WITHDRAWN
    "submittedAt": "2026-08-09T09:05:00+05:30",
    "aboveBandByPaise": null,        // set only while PENDING_APPROVAL
    "tripId": "TR-20881",            // set only when WON
    "lostReason": null               // AWARDED_ELSEWHERE | INDENT_CANCELLED | EXPIRED | null
  }
]
```

`lostReason` is a **fixed enum, never free text**. A lost quote carries no winning price, no
quote count, no competitor name — the prototype's *"Awarded at ₹23,100 to another vendor"* is
a `BR-55` breach and is not implemented.

### `DELETE /portal/quotes/:id` — spec'd (part 03)

Withdraw, allowed only while `SUBMITTED`. `204` on success. `409 QUOTE_NOT_WITHDRAWABLE`
once it is awarded, lost or already withdrawn.

---

## 3. Trips — `apps/vendor-portal/src/app/trips/`

### `GET /portal/trips` — spec'd (part 05 §1)

Query: `status` (comma-separated, optional). The card leads with **what is owed**, so the
amounts are not optional fields.

```jsonc
// data: Trip[]
[
  {
    "id": "TR-20881",
    "lrNo": "NXR/LR/26/0884",             // null until the LR is issued (BR-13)
    "originCity": "Nashik",
    "destinationCity": "Kolkata",
    "distanceKm": 1912,
    "status": "PLACED",                   // PLACED|REPORTED|LOADED|IN_TRANSIT|DELIVERED|CLOSED
    "podStatus": "PENDING",               // PENDING|ATTACHED|RECEIVED|VERIFIED|APPROVED|REJECTED — BR-48
    "podRejectionReason": null,           // set only when REJECTED — BR-52
    "vehicleRegistrationNo": "MH 15 GT 4482",
    "driverName": "Sandeep Rathod",
    "driverPhone": "98220 41xx",
    "freightPaise": 5840000,              // the vendor's own awarded rate, never the client's
    "advancePct": 40,
    "advancePaise": 2336000,
    "advanceReleasedAt": null,
    "advanceUtr": null,
    "advanceBlockers": [                  // BR-58 documents gating the advance; [] once released
      { "what": "Driving licence not on file", "why": "Nothing uploaded for Sandeep Rathod" }
    ],
    "balancePaise": 3504000,
    "penaltyPaise": 0,
    "netPayablePaise": 3504000,
    "deliveredAt": null,
    "podDaysElapsed": null,               // days since delivery; drives the clock
    "podPenaltyPerDayPaise": 10000,       // BR-24
    "billId": null,
    "milestones": [
      { "key": "PLACED", "label": "Placement confirmed", "at": "2026-08-10T18:40:00+05:30", "done": true }
    ]
  }
]
```

`penaltyPaise` and `netPayablePaise` are **server-computed**. The FE renders the same
arithmetic for the clock (`src/app/trips/pod-clock.ts`, checked by `pnpm --filter vendor-portal check`)
but never treats its own number as authoritative.

### `GET /portal/trips/:id` — **new**

Same object, for the trip screen and its refresh path. Not in the spec index — same decision
as `GET /portal/loads/:code`.

### `GET /portal/trips/:id/lorry-receipt` — spec'd (part 05 §2 · `BR-54`)

```jsonc
{
  "lrNo": "NXR/LR/26/0884",
  "issuedAt": "2026-08-11T09:15:00+05:30",
  "originCity": "Nashik", "destinationCity": "Kolkata",
  "goods": "Decorative paint, 640 cartons",
  "weightKg": 18000,
  "truckType": "32 ft SXL",
  "vehicleRegistrationNo": "MH 15 GT 4482",
  "driverName": "Sandeep Rathod",
  "driverLicenceNo": "MH15 20190004471",
  "transitDays": 4,
  "ewayBillNo": "4418 2290 7731",
  "ewayValidUpto": "2026-08-16T23:59:00+05:30",
  "freightPaise": 4120000,
  "advancePaise": 1236000,
  "balancePaise": 2884000,
  "pdfUrl": "https://…"                  // signed, 15-minute expiry, server-rendered
}
```

**Absent by contract:** `consignor`, `consignee`, `clientName`, `clientInvoiceNo`,
`clientInvoiceValue`, `sellRate`. The PDF behind `pdfUrl` **does** carry consignor and
consignee — that is the legal document and the reason it is server-rendered, never built from
this payload. The FE renders the Code 39 barcode from `lrNo` client-side
(`src/lib/code39.ts`); share is a plain action and gates nothing (`BR-22`).

### `POST /portal/trips/:id/pod` — spec'd (part 06 · `BR-51`, `D-33`)

`multipart/form-data`:

| Field | Type | Req | FE validation |
|---|---|---|---|
| `files` | file[] | ● | ≥ 1, image or PDF, ≤ 10 MB each |
| `courierDocketNo` | text | ● | non-empty, rendered mono |
| `sentOn` | date `YYYY-MM-DD` | ● | ≤ today |
| `note` | text | ○ | shortage, damage, detention hours |

`201` on success. The server must set the POD to `ATTACHED` and **must not** set
`pod_received_at` — attaching stops no clock (`BR-49`, `D-35`), and the screen says so.

Errors the FE renders: `422 POD_DOCKET_REQUIRED` · `422 POD_SENT_ON_INVALID` ·
`422 POD_FILES_REQUIRED` · `422 FILE_TOO_LARGE` · `403 VENDOR_SUSPENDED` · `404` for another
vendor's trip.

### `GET /portal/trips/:id/bill` — **new** (the blocked-state checklist)

Part 07 specifies only `POST`, but the screen must render *"✓ Trip delivered / ✗ POD not yet
approved"* **before** anyone types a bill number, and the amounts panel is read-only computed.

```jsonc
{
  "tripId": "TR-20860",
  "submittable": true,
  "conditions": [                        // rendered met and unmet, in order
    { "label": "Trip delivered", "met": true },
    { "label": "Proof of delivery approved", "met": true }
  ],
  "freightPaise": 2265000,
  "agreedChargesPaise": 0,
  "billTotalPaise": 1359000
}
```

### `POST /portal/trips/:id/bill` — spec'd (part 07 · `BR-53`)

`multipart/form-data`: `billNo` (text, unique per vendor), `billDate` (`YYYY-MM-DD`, ≤ today),
`file` (image or PDF).

```jsonc
// data (201)
{
  "id": "VBL-0091",
  "billNo": "RR/26-27/118",
  "computedBalancePaise": 1359000,
  "billedPaise": 1399000,
  "variancePaise": 40000            // signed; the FE states it back verbatim
}
```

A bill above the computed balance is **accepted and flagged**, never rejected — the
transporter may be right. Errors: `409 POD_NOT_APPROVED` · `409 BILL_NO_DUPLICATE` ·
`422 BILL_DATE_FUTURE` · `422 BILL_FILE_REQUIRED`.

---

## 4. Fleet — `apps/vendor-portal/src/app/fleet/`

### `GET /portal/fleet` — spec'd (part 04)

Optional query `availability=AVAILABLE`, used by the quote form's vehicle selector.

```jsonc
[
  {
    "id": "VH-7721",
    "registrationNo": "MH 12 RB 7721",
    "truckType": "40 ft trailer",
    "capacityKg": 24000,
    "currentCity": "Pune",
    "status": "DOCS_DUE",              // AVAILABLE | ON_TRIP | DOCS_DUE | MAINTENANCE
    "freeFrom": null,                  // required when ON_TRIP
    "docsDue": {                       // present only while DOCS_DUE — never a bare pill
      "documentKind": "FITNESS",
      "documentLabel": "Fitness certificate",
      "expiredOn": "2026-08-02"
    }
  }
]
```

### `POST /portal/fleet` · `PATCH /portal/fleet/:id` — spec'd (part 04)

```jsonc
{ "registrationNo": "MH 15 GT 4482", "truckType": "32 ft SXL", "capacityKg": 21000,
  "currentCity": "Nashik", "status": "AVAILABLE", "freeFrom": "2026-08-15" }
```

- Registration is unique **within the vendor**, not globally — a global constraint leaks
  `NFR-02` through the error message. `409 VEHICLE_DUPLICATE` on a within-vendor clash.
- `DOCS_DUE` is **not caller-settable** and not clearable — `422 DOCS_DUE_NOT_SETTABLE`. The FE
  never offers it; the server must still refuse it (`NFR-01`).
- `ON_TRIP` without `freeFrom` → `422 FREE_FROM_REQUIRED`.

---

## 5. Profile & KYC — `apps/vendor-portal/src/app/profile/`

### `GET /portal/profile` — spec'd (part 08)

```jsonc
{
  "vendorCode": "V-2214",
  "companyName": "Rathod Roadlines",
  "contactName": "Sandeep Rathod",
  "phone": "98220 41xx",
  "city": "Nashik",
  "gstin": "27AABCR1234M1Z5",         // nullable
  "panMasked": "AABCR****M",
  "aadhaarLast4": "4471",             // BR-04, NFR-04 — four characters at most, ever
  "bankAccountMasked": "••••••7741",
  "bankIfsc": "SBIN0001234",
  "advancePolicyPct": 40,             // BR-30
  "business": { "trips": 128, "valuePaise": 742000000, "outstandingPaise": 5336000 },
  "documents": [
    {
      "group": "Identity — verified once, not per load",
      "documents": [
        {
          "kind": "ADDRESS_PROOF",
          "label": "Address proof",
          "status": "REJECTED",       // MISSING|PENDING|VERIFIED|REJECTED|EXPIRED
          "rejectionReason": "Electricity bill is more than three months old.",
          "rejectedOn": "2026-08-03",
          "expiredOn": null,
          "groundsVehicleRegistrationNo": null,  // set when an expiry causes DOCS_DUE
          "capture": false,            // true → FE renders capture="environment"
          "needsGeotag": false         // selfie only
        }
      ]
    }
  ]
}
```

`rejectionReason` is mandatory whenever `status = REJECTED` — a rejection without one is
re-uploaded identically and rejected again.

### `POST /portal/profile/documents/:kind` — spec'd (part 08 · `BR-23`)

`multipart/form-data`: `file` (●), plus `latitude`/`longitude` when `needsGeotag` (the
selfie). Re-upload resets the document to `PENDING`, never straight to `VERIFIED`. Attachment
URLs are signed with 15-minute expiry. A suspended vendor can read the profile but not upload
(`403 VENDOR_SUSPENDED`).

---

## 6. Not yet built

| Screen | Endpoint | Part |
|---|---|---|
| Login / session | `POST /portal/auth/login`, `GET /portal/me` | 01 |

Everything else in the prototype and in parts 03–08 is built and calling the contracts above.

---

## 7. Open questions for the backend

1. **`GET /portal/loads/:code`** — add it, or is the list the only read path?
2. **Truck-type filter encoding** — FE sends `?truckType=32 ft SXL,22 ft container` (comma-joined). Confirm, or switch to repeated params.
3. **Vehicle identity on a quote** — FE sends `vehicleId`. If the API wants `registrationNo`, say so now; the FE holds both.
4. **`advancePct` per load** — prototype treats it as a policy constant; contract has it per load. Confirm it varies by lane.
5. **POD** — prototype shows a native camera flow, but part 06 requires courier docket + sent-on date, and the native shell (part 09) is blocked. Built as file-attach + docket + date (`capture="environment"` still opens the phone camera).
6. **`GET /portal/trips/:id`** and **`GET /portal/trips/:id/bill`** — both new; see §3. Without them the trip and bill screens cannot survive a refresh or render the blocked-state checklist.
7. **`podDaysElapsed`** — server-computed from delivery, or should the FE derive it from `deliveredAt`? FE currently trusts the server field and only formats it.
8. **Vehicle documents** — `DOCS_DUE` names one lapsed document per vehicle. If several lapse at once, is `docsDue` the earliest, or should it become an array?
9. **Suspension** — no screen yet. Which endpoints return `403 VENDOR_SUSPENDED`, and does `GET /portal/me` carry the suspension so the shell can render a banner?
