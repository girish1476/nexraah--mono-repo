# Part 08 · Invoicing and receivables — wave C7

| | |
|---|---|
| **Wave** | C7 |
| **Depends on** | 05 (billed charge amounts come from charge capture) |
| **Rules owned** | `BR-15`, `BR-16`, `BR-17` |
| **Screens** | `/invoices`, `/invoices/new`, `/invoices/[id]`, `/receivables`, `/print/invoice/[invoiceId]` |
| **Module** | `MOD-INV` · **Permission** `invoice.create`, `receipt.record` — seeded to `FINANCE` |

> **This is our invoice to the client.** The transporter's bill to us is part 07 §3 — two documents that were being conflated (`D-37`). Both are under reverse charge; neither carries GST.

---

## 1 · Create — `/invoices/new` · `invoice.create`

Number (series) · invoice date ● · due date (from client credit days) · client ● · consignments ○ (one or many delivered unbilled trips) · freight ● · loading / unloading / detention / other ○ (**billed amounts** from charge capture, part 05 §4) · discount ○ · round off · total · notes ○

**There are no tax fields on this screen** (`BR-15`, `D-06`, `D-26`). In their place:

```
GST PAYABLE BY RECIPIENT UNDER REVERSE CHARGE
Section 9(3), CGST Act 2017. No tax has been charged on this invoice.
```

The `invoices` table nonetheless keeps nil tax-component columns and a `tax_mechanism` defaulting to `REVERSE_CHARGE` (FSD B5). Nothing writes them today; they exist so the later forward-charge entity (`D-26`) is a configuration change rather than a migration.

Freight is always billed. Loading, unloading, detention and other heads appear **only where that client's arrangement provides for them** (`D-04`) — they are not assumed on every load, and the figures are the marked-up billed values, not the cost paid to the transporter (`BR-45`, `D-25`).

`Generate invoice` consumes the `NEX-INV-` number (`BR-14`) inside the issuing transaction → `ISSUED`.

**Rounding to the rupee happens here and only here** (`NFR-09`) — `invoices.round_off`. Every upstream figure stayed exact in paise.

---

## 2 · Ledger and detail

Search by number, client, phone or date. Chips: today · this week · this month · paid · pending. Ageing stack 0–30 / 31–60 / 61–90 / 90+. **No GST columns anywhere.** Invoice numbers are links.

Detail: value · received · balance · receipts. Print → **four copies** (`BR-17`). Cancel with reason; **never deleted** — a cancelled invoice keeps its number and its reason.

### 2.1 Print layout — `/print/invoice/[invoiceId]`

FSD B6. A4, **four copies labelled shipper · consignee · POD · POD duplicate**, each carrying the company block (GSTIN, PAN, CIN from the control panel), the charge table across the six heads, the reverse-charge declaration above, terms, a barcode of the invoice number, and an authorised-signature block.

---

## 3 · Receivables — `/receivables` · `receipt.record`

Against invoice ● · amount ● (≤ balance) · received on ● · mode ● · **UTR/cheque ●** · remarks ○ → consumes the `RCT-` series.

Full → `PAID`; partial → `PART_PAID`, and the balance stays in the ageing (`BR-16`). A receipt equal to or greater than the balance closes the invoice; any lesser amount part-pays it.

---

## 4 · Endpoints

```
POST   /invoices                     invoice.create      draft
POST   /invoices/:id/generate        invoice.create      → NEX-INV-, ISSUED
GET    /invoices?q=&status=&from=&to=
GET    /invoices/:id
POST   /invoices/:id/cancel          { reason }          never deletes
GET    /invoices/:id/print           four copies
POST   /receipts                     receipt.record      BR-16
GET    /receivables?ageing=&client=
```

Invoice issue, cancellation and receipt recording each write an `audit_events` row (part 01 §8.1).

---

## 5 · Accounting boundary

Nexraah produces invoices and receipts; it is **not the books of account** (FSD B1) and must reconcile to whatever accounting software the company keeps. The integration is a one-way periodic export (part 13) — issued invoices, receipts and released payments as a journal file, plus a reconciliation report of whatever the accounting system rejected. It must not drift into becoming the ledger.

---

## 6 · Done when

- [ ] No GST field, column or line exists on the create screen, the ledger, the detail page or any of the four printed copies (`BR-15`)
- [ ] The reverse-charge declaration appears on screen and on every copy
- [ ] Print produces exactly four labelled copies (`BR-17`)
- [ ] A receipt equal to the balance marks `PAID`; a lesser one marks `PART_PAID` and leaves the remainder in the ageing (`BR-16`)
- [ ] Cancelling keeps the row and the number, with a reason
- [ ] Charge heads carry the **billed** amount, not the cost
- [ ] Rounding happens once, at the invoice total (`NFR-09`)

**Tests** (part 13 §23): 10.
