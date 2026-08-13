# 02 · Vendors and compliance — wave C2

`BR-01` is the gate the whole supply side hangs on: an uncleared vendor is never assignable, by any route, including import.

Frontend: `src/app/vendors/apis.ts` · `src/app/vendors/types.ts`

---

## `GET /vendors`

**Query** — `q` (name or code), `status`, `branch`.

**Response**

```json
[{
  "id": "v-2214", "code": "VND-2214", "legalName": "Rathod Roadlines",
  "partyType": "VENDOR", "baseCity": "Nashik", "branchName": "Nashik",
  "phone": "9822014471", "status": "PENDING_VERIFICATION",
  "advancePct": 40, "fleetCount": 14, "rating": 4.4,
  "trips": 41, "marginPaise": 24100000
}]
```

`status` ∈ `DRAFT · PENDING_VERIFICATION · ACTIVE · SUSPENDED · BLACKLISTED`.
`marginPaise` is **our** margin on their work — the answer to "is this transporter cheap or just available".

---

## `GET /vendors/:id`

**Response** — the full file. Abridged:

```json
{
  "id": "v-2214", "code": "VND-2214", "legalName": "Rathod Roadlines",
  "partyType": "VENDOR", "constitution": "Proprietorship",
  "gstin": "27AAKCR2148L1ZP", "pan": "AAKCR2148L",
  "phone": "9822014471", "altPhone": "9822014472",
  "baseCity": "Nashik", "branchId": "br-nsk", "branchName": "Nashik",
  "fleetBase": "Nashik", "operatingStates": ["MH","GJ","MP","WB"],
  "advancePct": 40,
  "bankAccount": "••4471", "ifsc": "HDFC0000188", "accountHolder": "Rathod Roadlines",
  "status": "PENDING_VERIFICATION", "verifiedBy": null,
  "panelDate": "2024-03-11", "rating": 4.4, "source": "FIELD", "fleetCount": 14,

  "kyc": [
    { "kind": "AADHAAR", "valueMasked": "4471", "route": "API",
      "status": "VERIFIED", "verifiedBy": "Meera Iyer", "verifiedAt": "…" }
  ],
  "documents": [
    { "kind": "TRANSPORTER_AGREEMENT", "reference": null, "status": "MISSING",
      "validTo": null, "attachmentId": null }
  ],
  "advanceHistory": [
    { "oldPct": 40, "newPct": 70, "changedBy": "Meera Iyer",
      "changedAt": "2025-09-04", "approvalId": "apr-old-1" }
  ],
  "fleet": [
    { "registration": "MH 15 GT 4482", "type": "32 ft SXL", "capacityTn": 21,
      "bodyType": "Closed", "currentCity": "Kolkata", "status": "ON_TRIP" }
  ],
  "business": {
    "trips": 41, "revenuePaise": 189400000, "marginPaise": 24100000,
    "advanceOutstandingPaise": 2336000, "balancePendingPaise": 3504000,
    "penaltiesAccruedPaise": 40000,
    "topLanes": [{ "lane": "Nashik → Kolkata", "trips": 12, "marginPct": 13.1 }]
  }
}
```

**`BR-04` — `kyc[kind=AADHAAR].valueMasked` holds the last four digits and nothing more.** The full number must not exist in the database, let alone in this response. The column constraint in part 02 §6 enforces it.

`kyc[].status` and `documents[].status` ∈ `MISSING · PENDING · VERIFIED · REJECTED`.
`fleet[].status` ∈ `AVAILABLE · ON_TRIP · DOCS_DUE · MAINTENANCE`.

---

## Onboarding — part 03 §1

| Call | Body | Notes |
|---|---|---|
| `POST /vendors` | company step fields | Creates the `DRAFT`. Branch is **derived** from the base city within 150 km (`BR-34`); two in range → the client's operating location decides and leadership may override (`BR-47`) |
| `PATCH /vendors/:id` | any subset | Per-step draft save |
| `POST /vendors/:id/kyc/:kind` | `{ value, route, attachmentId }` | `kind` ∈ `PAN · AADHAAR · ADDRESS · SELFIE`. `route` ∈ `API · MANUAL` (`BR-31`) — the route taken and the verifier are recorded and never repeated per load |
| `POST /vendors/:id/kyc/:kind/verify` | — | `vendor.verify` |
| `POST /vendors/:id/documents/:kind` | `{ attachmentId, reference?, validFrom?, validTo? }` | `kind` ∈ `RC · TRADE_LICENCE · LABOUR_LICENCE · UDYAM · TDS_DECLARATION · BANK_STATEMENT · TRANSPORTER_AGREEMENT` |
| `POST /vendors/:id/submit` | — | → `PENDING_VERIFICATION` |
| `POST /vendors/:id/activate` | — | `vendor.activate` → `ACTIVE` |

The **geo-stamped selfie** is our executive standing with the transporter at their yard, captured by an internal user. The transporter portal does not own it.

### Submit errors

`409 VENDOR_INCOMPLETE` with `details.unmet[]`:

- **`BR-02`** — an Owner without an RC cannot be submitted; a Vendor without any legal document cannot either.
- **`BR-03`** — no TDS declaration, no submission, whatever the party type. It is held on file and nothing is deducted (`BR-33`, `D-24`).

### Activate

`POST /vendors/:id/activate` is the only route to `ACTIVE`. It:

1. refuses with `409 VENDOR_INCOMPLETE` and the unmet list if any KYC item or document is not `VERIFIED` (`BR-01`);
2. creates the transporter's portal login (`vendor_users`) — **Spec 1 §2.1 is the other side of this call**;
3. sends the first-login SMS through the DLT gateway;
4. writes a `STATUS_CHANGE` audit row.

---

## `PATCH /vendors/:id/advance-policy`

**Permission** — `vendor.advance_policy`.
**Body** — `{ "advancePct": 70, "reason": "at least twenty characters" }`

**Always `202 ADVANCE_POLICY_CHANGE`.** Never applied directly (`BR-57`). On approval it writes a `vendor_advance_history` row carrying the old value, the new value, the approval and the actor, plus an audit row.

`400 REASON_TOO_SHORT` under 20 characters.

---

## Leads · market gap · issues

```
GET   /vendors/leads              POST /vendors/leads        PATCH /vendors/leads/:id
GET   /vendors/market-gap         PATCH /vendors/market-gap/:id     { target }
GET   /vendors/issues             POST /vendors/issues       PATCH /vendors/issues/:id
```

**Lead** — `{ id, code: "LD-0084", name, city, source, partyType, trucksClaimed, phone, stage, notes }`
`stage` ∈ `NEW · CONTACTED · DOCUMENTS_REQUESTED · QUALIFIED · CONVERTED · DROPPED`.

**Market gap row** — `{ id, branchId, branchName, lane, truckType, target, onPanel, converted, gap, progressPct }`
`gap` and `progressPct` are **computed server-side**; the screen does not derive them. Branch-scoped for `BRANCH_MGR`.

**Issue** — `{ id, code: "IS-0041", vendorId, vendorName, category, severity, tripCode, raisedBy, raisedAt, status, note }`
`severity` ∈ `LOW · MEDIUM · HIGH`; `status` ∈ `OPEN · IN_PROGRESS · RESOLVED`.

Market gap is where `D-19` lands: a band that draws no in-band quote is a recruitment problem, never a licence to widen the band.

---

## `GET /compliance/queues`

One queue in three segments (part 03 §4). Each row is renderable without a second call.

```json
[{
  "key": "TRIP_DOCUMENTS",
  "name": "Trip documents awaiting verification",
  "rows": [{
    "ref": "TRP-120881",
    "subject": "Nashik → Kolkata",
    "note": "RC uploaded 11 Aug · blocking ₹23,360 advance",
    "ageDays": 1,
    "flag": "Blocking money",
    "tone": "red",
    "href": "/trips/t-120881/documents",
    "action": "Verify"
  }]
}]
```

`key` ∈ `VENDOR_FILES · CLIENT_CONTRACTS · TRIP_DOCUMENTS`. `tone` ∈ `mint · flag · red · blue · grey`.
`href` is a portal route, composed server-side so the desk can link straight into the work.

The client-contracts segment **warns when a contract has no rate card lanes**.

---

## Done when

- [ ] A vendor with any mandatory KYC item missing cannot be activated, by API or by import
- [ ] An Owner without an RC cannot be submitted (`BR-02`); no TDS declaration, no submission (`BR-03`)
- [ ] The full Aadhaar number is nowhere in the database (`BR-04`)
- [ ] Verification route and verifier are recorded on every check and never repeated per load (`BR-31`)
- [ ] Two branches within 150 km → the override is recorded with a reason (`BR-34`, `BR-47`)
- [ ] Advance policy change returns `202` and does not apply until approved (`BR-57`)
- [ ] Activation creates the portal account and sends the SMS
