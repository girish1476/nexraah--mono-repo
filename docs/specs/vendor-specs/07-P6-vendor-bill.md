# 07 · Raise your bill — wave `P6`

**Depends on:** 06 · console `C5` (POD approved) + `C6` (balance computed, finance queue)
**Delivers:** the transporter's own bill to us — a different document from our invoice to the client.
**Owns:** `BR-53`

---

## 1 · The conflation this part exists to end — `D-37`

Two documents were being treated as one:

| Document | Raised by | To whom | Module |
|---|---|---|---|
| **Transporter bill** | The transporter, here | Us | `MOD-VBL` |
| **Tax invoice** | Us | The client | `MOD-INV`, console part 08 |

Both move under reverse charge and **neither carries GST**. They are otherwise unrelated: different numbers, different parties, different amounts. A transporter bill is an input cost; a tax invoice is revenue.

---

## 2 · Screen — `/portal/trips/[id]/bill`

`POST /portal/trips/:id/bill` · `portal.bill` · `BR-53`, `D-37`

Amounts panel — **computed, read-only**: freight, agreed charges, bill total.

| Field | Type | Req | Validation |
|---|---|---|---|
| Your bill number | text | ● | Mono. Unique per vendor |
| Bill date | date | ● | ≤ today |
| Attach your bill copy | file | ● | Image or PDF |

### Declaration block, always visible

```
TAX PAYABLE UNDER REVERSE CHARGE
Do not add GST to this bill. Nexraah accounts for the tax
under the reverse charge mechanism.
```

It sits on the form, not in help text. A transporter who adds 18% GST to a bill we cannot claim creates a reconciliation problem that finance resolves by phone, one bill at a time. Saying it where the number is typed is the whole intervention.

### Blocked until the POD is approved — `BR-53`

```
🔒 Not yet submittable
   ✗ Proof of delivery not yet approved
   ✓ Trip delivered
```

The checklist shows what is done as well as what is not. `POST` before approval returns `409 POD_NOT_APPROVED` — the server refuses it whatever the screen renders (`NFR-01`).

---

## 3 · Variance — flagged, never rejected

On submit the server computes the balance and records the variance against the bill.

**A mismatch does not reject the bill.** It flags it for finance, because **the transporter may be right** — a detention charge agreed verbally at the consignee, an extra halt, a charge written on the POD that verification missed. Finance sees the bill beside the computed balance with the variance in ₹ and %, and decides (console part 07 §12.3).

What the transporter sees after submitting:

> **Bill received.** We compute ₹28,650 against your ₹29,050. Finance will review the ₹400 difference before releasing.

Naming the difference immediately is what stops the follow-up call. Silence here reads as a dispute we have not noticed.

---

## 4 · Endpoints

| Method | Path | Permission | Rules |
|---|---|---|---|
| POST | `/portal/trips/:id/bill` | `portal.bill` | `BR-53` |

Server-side on insert (console part 02 §20.4): `vendor_bills` insert is blocked unless `trip.pod_status = 'APPROVED'`.

---

## 5 · Tests

- [ ] Submit before POD `APPROVED` → `409 POD_NOT_APPROVED`, nothing written
- [ ] Submit after approval → `201`, `computed_balance` and `variance` populated
- [ ] Duplicate bill number within the vendor → `409`; the same number under another vendor → `201`
- [ ] Bill date in the future → `422`
- [ ] Missing attachment → `422`
- [ ] A bill above the computed balance is **accepted** and flagged, not rejected
- [ ] Submitting against another vendor's trip → **404**
- [ ] The response names the variance in rupees
- [ ] Suspended vendor cannot submit (`403 VENDOR_SUSPENDED`)

---

## 6 · Done when

- [ ] The reverse-charge declaration is on the form beside the amount, not in a help panel
- [ ] The blocked state lists both met and unmet conditions
- [ ] Variance is stated back to the transporter on submission
- [ ] Every test above passes
