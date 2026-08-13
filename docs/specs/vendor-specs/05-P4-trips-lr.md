# 05 · Trips & lorry receipt — wave `P4`

**Depends on:** 02 · console `C4` (trip created, LR issued)
**Delivers:** the awarded consignment, what is owed on it, and the document the driver carries.
**Owns:** `BR-54`

---

## 1 · Trips — `/portal/trips`

`GET /portal/trips?status=` · `portal.self`

Awarded consignments. Card per trip: trip number, LR number, lane, vehicle, status, and **what is owed on it**.

"What is owed" is the reason this screen gets opened. Lead with it:

```
₹28,650 due on POD
₹12,450 advance paid 4 Aug · UTR HDFC0004471829
```

Three actions per trip, each its own part:

| Action | Part | Available when |
|---|---|---|
| **Lorry receipt** | this part §2 | LR issued (`BR-13`) |
| **Proof of delivery** | 06 | Trip `DELIVERED` |
| **Raise your bill** | 07 | POD `APPROVED` (`BR-53`) |

Render all three always, with the unavailable ones disabled and stating what would unblock them. A hidden button teaches nothing; a disabled one with `✗ Proof of delivery not yet approved` teaches the whole workflow.

---

## 2 · Lorry receipt — `/portal/trips/[id]/lorry-receipt`

`GET /portal/trips/:id/lorry-receipt` → `PortalLorryReceiptDTO` · `portal.self` · `BR-54`

Visible because the transporter carries the document and could not otherwise see what they are carrying (`D-36`). Redacted per part 02 §2.

**Layout:** centred LR number in mono, Code 39 barcode, "Released to you" pill. Key-value panel of booking, lane, goods, weight, vehicle, driver, transit days, e-way number and validity. Then **Your freight**:

```
Agreed freight        ₹41,200
Advance paid         −₹12,360
Balance on POD        ₹28,840
```

**Actions:** **Download PDF** (primary, signed URL) · **Share** (secondary — optional, `BR-22`).

Note: *"Carry a printed copy. The barcode is scanned at checkposts and at the consignee."*

### `BR-22` — share is optional, never a step

Sharing must not appear in any progress indicator, must not gate the trip moving to `IN_TRANSIT`, and must not produce a nag if unused. The LR and the E-LR are one record; electronic sharing is a convenience for a transporter who asked for it. The printed copy remains the primary form.

### The PDF is server-rendered

`pdfUrl` is a **signed URL with 15-minute expiry** pointing at a document the server renders — not a client-side render of the DTO.

This matters because the printed LR legally must carry **consignor and consignee**, and the DTO deliberately does not (part 02 §2). The server renders the full document; the portal never receives those fields. A client-side PDF would need them in the payload, which is the leak the whole contract exists to prevent.

The transporter therefore sees a document containing more than the screen above it. That is correct and intended: paper goes to one consignee, a searchable portal record goes to every load they ever carried.

---

## 3 · Endpoints

| Method | Path | Permission | Rules |
|---|---|---|---|
| GET | `/portal/trips?status=` | `portal.self` | Vendor-scoped |
| GET | `/portal/trips/:id/lorry-receipt` | `portal.self` | `BR-54` |

Another vendor's trip → **404, not 403** (part 02 §4).

---

## 4 · Tests

- [ ] `GET /portal/trips` returns only this vendor's trips
- [ ] `GET /portal/trips/{vendorB_trip}/lorry-receipt` → **404**
- [ ] LR DTO contains no `consignor`, `consignee`, `clientName`, `clientInvoiceNo`, `clientInvoiceValue`, `sellRate`
- [ ] The rendered PDF **does** contain consignor and consignee — the legal requirement, proving the redaction is at the payload and not at the document
- [ ] `pdfUrl` expires; a request after 15 minutes fails
- [ ] Barcode payload is Code 39 of `lrNo`
- [ ] `freight` equals the vendor's own awarded rate, never the client's rate
- [ ] Share is absent from every progress indicator and gates nothing (`BR-22`)
- [ ] Trip actions render disabled with a reason when unavailable

---

## 5 · Done when

- [ ] Trip card leads with what is owed
- [ ] LR screen readable on a 360px viewport; barcode scannable from the screen
- [ ] Download works from a phone browser with no shell present
- [ ] Every test above passes
