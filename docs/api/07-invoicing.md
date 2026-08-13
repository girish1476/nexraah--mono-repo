# 07 · Invoicing and receivables — wave C7

**Our invoice to the client.** The transporter's bill to us is `06-payments` §bills — two documents that were being conflated (`D-37`). Both are under reverse charge; neither carries GST.

Frontend: `src/app/invoices/apis.ts` · `src/app/receivables/page.tsx`

---

## No tax fields anywhere

There is **no GST field, column or line** on the create screen, the ledger, the detail page, any of the four printed copies, or any shape in this document (`BR-15`, `D-06`, `D-26`). In their place:

```
GST PAYABLE BY RECIPIENT UNDER REVERSE CHARGE
Section 9(3), CGST Act 2017. No tax has been charged on this invoice.
```

The `invoices` table nonetheless keeps nil tax-component columns and `tax_mechanism` defaulting to `REVERSE_CHARGE` (FSD B5). Nothing writes them; they exist so a later forward-charge entity is a configuration change rather than a migration. **They must not appear in the API response** — the frontend has no field for them.

---

## `GET /invoices`

**Query** — `q`, `status`, `from`, `to`.

```json
[{
  "id": "inv-411", "code": "NEX-INV-000411",
  "clientId": "c-0092", "clientName": "Berger Paints",
  "invoiceDate": "…", "dueDate": "…",
  "tripIds": ["t-120874"],
  "freightPaise": 2240000, "loadingPaise": 0, "unloadingPaise": 0,
  "detentionPaise": 0, "otherPaise": 0, "discountPaise": 0,
  "roundOffPaise": 0, "totalPaise": 2240000, "receivedPaise": 1000000,
  "taxMechanism": "REVERSE_CHARGE",
  "status": "PART_PAID", "cancelReason": null, "notes": ""
}]
```

`status` ∈ `DRAFT · ISSUED · PART_PAID · PAID · CANCELLED`. `code` is `null` until the invoice is generated.

---

## `GET /invoices/:id`

The list shape plus everything the detail page and the print sheet need in one call:

```json
{
  "company": { "name": "…", "gstin": "…", "pan": "…", "cin": "…", "address": "…", "bank": "…" },
  "client": { "id": "c-0092", "name": "Berger Paints", "billingCity": "Kolkata", "gstin": "…", "creditDays": 45 },
  "trips": [{ "id": "t-120874", "code": "TRP-120874", "lrCode": "LR-88207",
              "lane": "Pune → Surat", "deliveredAt": "…", "sellRatePaise": 2240000 }],
  "receipts": [{ "id": "r-1", "code": "RCT-0330", "amountPaise": 1000000,
                 "receivedOn": "…", "mode": "NEFT", "reference": "HDFC26081144", "remarks": "" }]
}
```

`company` is embedded so `/print/invoice/[invoiceId]` needs no second call.

---

## `POST /invoices` · `POST /invoices/:id/generate`

**Permission** — `invoice.create` (seeded to FINANCE).

`POST /invoices` creates a `DRAFT` with a `null` code. Body is the charge fields above plus `clientId`, `invoiceDate`, `dueDate`, `tripIds[]`, `notes`.

`POST /invoices/:id/generate` consumes the `NEX-INV-` series inside the issuing transaction (`BR-14`) → `ISSUED`, and marks the trips billed. `409 ALREADY_ISSUED` on a second attempt.

**Rounding to the rupee happens here and only here** — `roundOffPaise` (`NFR-09`). Every upstream figure stayed exact in paise.

Freight is always billed. Loading, unloading, detention and other appear **only where that client's arrangement provides for them** (`D-04`), and the figures are the marked-up **billed** values from charge capture, not the cost paid to the transporter (`BR-45`, `D-25`).

---

## `POST /invoices/:id/cancel`

**Body** — `{ "reason": "…" }`, mandatory.

**Never deletes.** A cancelled invoice keeps its number and its reason.

---

## `POST /receipts`

**Permission** — `receipt.record`.

```json
{ "invoiceId": "inv-411", "amountPaise": 1240000, "receivedOn": "2026-08-10",
  "mode": "NEFT", "reference": "HDFC26081199", "remarks": "" }
```

`reference` is the UTR or cheque number and is **mandatory**. Consumes the `RCT-` series.

- amount ≥ balance → invoice `PAID`
- amount < balance → invoice `PART_PAID`, the remainder stays in the ageing (`BR-16`)
- amount > balance → `400 RECEIPT_EXCEEDS_BALANCE`

---

## `GET /receivables`

**Query** — `ageing`, `client`.

```json
{
  "rows": [{
    "invoiceId": "inv-410", "invoiceCode": "NEX-INV-000410",
    "clientName": "Apex Ceramics", "invoiceDate": "…", "dueDate": "…",
    "totalPaise": 3655000, "receivedPaise": 0, "balancePaise": 3655000,
    "bucket": "D0_30"
  }],
  "buckets": [
    { "bucket": "CURRENT",  "amountPaise": 0,       "count": 0 },
    { "bucket": "D0_30",    "amountPaise": 3655000, "count": 1 },
    { "bucket": "D31_60",   "amountPaise": 0,       "count": 0 },
    { "bucket": "D61_90",   "amountPaise": 0,       "count": 0 },
    { "bucket": "D90_PLUS", "amountPaise": 0,       "count": 0 }
  ],
  "receipts": [ /* recent receipts, same shape as above */ ]
}
```

`bucket` ∈ `CURRENT · D0_30 · D31_60 · D61_90 · D90_PLUS`, measured from `dueDate`. Buckets are **computed server-side**; the screen renders them.

---

## Print

`/print/invoice/[invoiceId]` renders **exactly four copies** labelled shipper · consignee · POD · POD duplicate (`BR-17`), each carrying the company block, the charge table across the six heads, the reverse-charge declaration, terms, a Code 39 barcode of the invoice number and an authorised-signature block.

---

## Accounting boundary

Nexraah produces invoices and receipts; it is **not the books of account** (FSD B1). The integration is a one-way periodic export of issued invoices, receipts and released payments as a journal file, plus a reconciliation report of whatever the accounting system rejected. It must not drift into becoming the ledger.

---

## Done when

- [ ] No GST field, column or line exists on any screen or in any of the four printed copies (`BR-15`)
- [ ] The reverse-charge declaration appears on screen and on every copy
- [ ] Print produces exactly four labelled copies (`BR-17`)
- [ ] A receipt equal to the balance marks `PAID`; a lesser one marks `PART_PAID` (`BR-16`)
- [ ] Cancelling keeps the row and the number, with a reason
- [ ] Charge heads carry the **billed** amount, not the cost
- [ ] Rounding happens once, at the invoice total (`NFR-09`)
