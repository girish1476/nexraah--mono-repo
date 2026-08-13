# Part 05 · Trips and lorry receipt — wave C4

| | |
|---|---|
| **Wave** | C4 |
| **Depends on** | 04 (a trip is created from a placed indent) |
| **Rules owned** | `BR-13`, `BR-22`, `BR-32`, `BR-44`, `BR-45`, `BR-58` (documents half), `BR-27`/`BR-28` (carried through) |
| **Screens** | `/trips`, `/trips/[id]`, `/trips/[id]/documents`, `/trips/[id]/charges`, `/trips/[id]/lr`, `/print/lr/[tripId]` |
| **Module** | `MOD-TRP`, `MOD-LR` · **Primary actor** `ACT-OPS` |

> **Purpose** (FSD B3.4): the operational and financial record of a consignment in motion. The trip number is generated for every order when the consignment is opened and carried alongside the indent number and the LR number for the life of the record.

---

## 1 · Search — `/trips`

Global search with a field selector: all · LR · trip no · indent · truck · transporter · company · branch. Filters: stage · company · transporter · branch · POD status. Search spans indents and trips together.

---

## 2 · Detail — details tab

Identifiers (trip no, LR no, indent) · consignment · truck & driver with utilisation gauge · **timing** (reporting required vs actual, transit days required vs actual, delay flag) · charges · remarks · milestones.

Transit days required comes from the indent (`BR-27`); actual is measured against it. Remarks carry from the indent through to the LR (`BR-28`).

---

## 3 · Documents tab — `/trips/[id]/documents`

Five groups, eleven documents. Each Upload → Verify → Verified, or Rejected with reason.

| Group | Documents | Gates the advance (`BR-58`) |
|---|---|---|
| **Client** | Client invoice or purchase order · E-way bill | Both |
| **Vehicle** | Registration certificate · Goods insurance · **Fitness certificate** · **Permit** · **Pollution certificate** | All five |
| **Driver** | Driving licence | Yes |
| **Lorry receipt** | LR | No — issued after placement |
| **POD** | Proof of delivery | No — gates the balance |

**Eight of the eleven gate the advance, and fitness, permit and PUC are in that set.** An expired fitness certificate is one of the specific examples FSD A3 gives for Leak 2, and Spec 1 §4.8 already marks a truck `DOCS_DUE` when RC, insurance, fitness or PUC lapses — the data exists at fleet level, so the gate has no excuse not to check it.

The set is read from `config.advance_document_set` (part 01 §4.2), seeded with those eight. Removing one is an audited configuration change (`NFR-03`).

Verification is performed by whoever holds `document.verify` (`BR-41`) — seeded to `OPS`, movable — and appears in the compliance desk queue (part 03 §4). Every verify and every reject writes an `audit_events` row of class `DOC_VERIFY`.

### 3.1 Cross-check — `BR-32`, `D-09`

Runs when client invoice, e-way bill and LR are all present:

| Compared | A | B |
|---|---|---|
| Invoice number · value | Client invoice | LR |
| Vehicle number | E-way bill | LR |
| Consignor GSTIN · consignee | Client invoice | LR |
| E-way validity | E-way bill | ≥ expected delivery |

**A mismatch must be flagged before the truck is dispatched**, not merely recorded. While any cross-check mismatch is open and unoverridden, `Generate LR` and the placement-complete action are blocked — the FSD's point is that these errors are penalised at a checkpost, so catching them after dispatch catches nothing.

**Mismatch** → red banner, field-by-field side by side. `Reject and request re-upload` primary (`BR-44`); `Override and proceed` requires a reason ≥ 20 chars from a role senior to ops (`BR-44`, `D-28`) and raises `DOC_OVERRIDE`. Where the error is ours, it is corrected in the system rather than worked around.

> Until OCR exists the uploader keys the values into `trip_documents.keyed_values` and the system compares them. Still worth doing — most mismatches are typing errors. Once NIC is connected (part 13) the e-way side stops being keyed and the check becomes authoritative.

---

## 4 · Charge capture — `/trips/[id]/charges`

`BR-45`, `D-25`. Captured **at POD verification**, from what is written on the document (`BR-56`) — part 06 opens this form inside the verify screen.

| Field | Req | Notes |
|---|---|---|
| Charge type ● | | Loading · Unloading · Labour · Halt · Detention · Other |
| **Cost to us** ● | | Payable to the transporter |
| **Billed to client** ● | | ≥ cost. Warn if below |
| Mark-up | derived | Shown in ₹ and % |

Cost and billed value are held in separate columns so the mark-up is visible in the margin (`BR-45`).

**This is what makes the P&L true.** Trips closed with no charges captured appear in the P&L exception panel (`R-01`) and in the weekly `charge-capture-exception` job.

---

## 5 · Lorry receipt — `/trips/[id]/lr`

One record on the trip (`BR-22`) — the LR and the E-LR are the same document, held once, never two rows. Sections: general · consignor · consignee · shipment · goods · invoice & e-way · vehicle & driver · transit days and remarks · six charge heads. Auto-saves every 3s as a draft.

`Generate LR` consumes the number (`BR-14`) inside the issuing transaction, and is **blocked until the truck is placed** (`BR-13`). Issuing it opens the trip.

**Share is optional** (`BR-22`) — used where the transporter or consignee asks for it, never a required step in the workflow. `lorry_receipts.shared_at` records it when it happens.

### 5.1 Print layout — `/print/lr/[tripId]`

FSD B6. A4 letterhead carrying company **GSTIN, PAN and CIN** from the control panel, consignor and consignee blocks, goods table, vehicle and driver, charge breakdown across the six heads, terms, a **Code 39 barcode of the LR number**, and **three signature blocks** — consignor, carrier, consignee. The printed copy is the primary form.

Statuses: Booked → Released → In transit → Delivered.

---

## 6 · Endpoints

```
GET    /trips?q=&field=&stage=&branch=&transporter=&pod_status=
GET    /trips/:id
POST   /trips/:id/documents/:kind          upload
POST   /trips/:id/documents/:kind/verify   document.verify
POST   /trips/:id/documents/:kind/reject   { reason }
GET    /trips/:id/cross-check              current mismatch set
POST   /trips/:id/cross-check/override     { reason ≥ 20 } → 202 DOC_OVERRIDE
GET    /trips/:id/charges · POST /trips/:id/charges
GET    /trips/:id/lr · PATCH /trips/:id/lr        autosave draft
POST   /trips/:id/lr/generate              BR-13, BR-14 → consumes LR-
POST   /trips/:id/lr/share                 optional, BR-22
```

---

## 7 · Done when

- [ ] `Generate LR` refuses before the truck is placed (`BR-13`)
- [ ] A second LR cannot be created for a trip — the unique constraint proves it (`BR-22`)
- [ ] Sharing is never required to move the trip forward (`BR-22`)
- [ ] All eleven documents render with state; the eight of `BR-58` are marked as gating
- [ ] An open cross-check mismatch blocks LR generation until rejected or overridden (`BR-32`)
- [ ] Override under 20 characters is refused; over 20 raises `DOC_OVERRIDE` and audits (`BR-44`)
- [ ] Charge rows carry cost and billed separately, and a billed figure below cost warns (`BR-45`)
- [ ] Removing a document from `config.advance_document_set` writes a `CONFIG` audit row

**Tests** (part 13 §23): 1, 2 (documents half), 15.
