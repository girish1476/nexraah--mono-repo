# Part 03 · Vendors and compliance — wave C2

| | |
|---|---|
| **Wave** | C2 — `BR-01` gates the supply side |
| **Depends on** | 01 (permissions, approvals, attachments, numbering, audit), 02 (schema) |
| **Rules owned** | `BR-01`, `BR-02`, `BR-03`, `BR-04`, `BR-23`, `BR-31`, `BR-34`, `BR-46`, `BR-47`, `BR-57` (vendor half), `NFR-04` |
| **Screens** | `/vendors`, `/vendors/new`, `/vendors/[id]`, `/vendors/leads`, `/vendors/market-gap`, `/vendors/issues`, `/compliance` |
| **Module** | `MOD-VND`, `MOD-CMP`, `MOD-LED` · **Primary actor** `ACT-CMP` |

> **Purpose** (FSD B3.1): establish that a transport company is real, solvent, insured and legally able to carry goods, before any load or money is entrusted to it.

---

## 1 · Onboarding — `/vendors/new` · `vendor.edit`

Five-step wizard, draft saved per step.

| Step | Fields | Rules |
|---|---|---|
| **1 Company** | Name ● · base city ● · party type ● (Owner/Vendor) · GSTIN ○ · phone ● unique · alternate ○ | Branch derived, 150 km (`BR-34`). Two branches in range → client operating location decides, leadership may override (`BR-47`). GSTIN checked against GSTN where present — advisory, never blocking |
| **2 Identity** | PAN number ● **+ card photo ●** · Aadhaar OTP ● **+ card photo ●** · address proof ● · geo-stamped selfie ● · trade licence / labour licence / RC / Udyam · TDS declaration ● | RC mandatory for Owner (`BR-02`); else ≥ 1 legal doc. **TDS declaration mandatory for every transporter, whatever the party type** (`BR-03`) — held on file, nothing deducted (`D-24`, `BR-33`). Aadhaar last-4 only (`BR-04`). Images retained for the relationship (`BR-46`) |
| **3 Fleet** | Trucks ● · body type ○ · fleet base ● · operating states ● | |
| **4 Payment** | Account ● · IFSC ● · holder ● · statement ● · **advance policy % ●** | Becomes the vendor default (`BR-30`, `D-22`). Every later change needs approval (`BR-57`) |
| **5 Review** | Verified by ● · remarks ○ | Submitting ≠ activating |

**The geo-stamped selfie is our executive with the transporter at their yard** (FSD A6) — proof our person physically visited. It is captured here, by an internal user, not by the transporter in the portal. Spec 1 does not own this.

**Verification route** per check: `API` or `MANUAL` (`BR-31`, `D-08`). Manual routes to the compliance queue. Build manual first — no external dependency. The route taken and the verifying person are recorded and never repeated per load.

```
POST   /vendors                       draft
POST   /vendors/:id/kyc/:kind         submit
POST   /vendors/:id/kyc/:kind/verify  vendor.verify
POST   /vendors/:id/documents/:kind
POST   /vendors/:id/submit            → PENDING_VERIFICATION
POST   /vendors/:id/activate          vendor.activate → ACTIVE, creates portal account
PATCH  /vendors/:id/advance-policy    vendor.advance_policy → 202 ADVANCE_POLICY_CHANGE
```

`POST /vendors/:id/activate` is what creates the transporter's portal login (`vendor_users`) and sends the first-login SMS through the DLT gateway — Spec 1 §2.1 is the other side of this call.

---

## 2 · Search and detail — `/vendors`, `/vendors/[id]`

Two segments.

**Trips & business:** stats, trips table, money with us (advance outstanding, balance pending, penalties accrued), **our margin on their work** — total and per lane — and top lanes.

**Vendor file:** KYC with method and verifier, legal documents with validity, advance policy with its change and approval history, fleet.

Margin per vendor is what FSD A6 asks the vendor page for. It is the answer to "is this transporter cheap or just available", and it is the only screen that can show it.

`Clear and activate` enables only on a complete file (`BR-01`) — the gate the entire supply side hangs on. An incomplete file cannot be activated by any route, including import (part 12).

---

## 3 · Leads, market gap, issues

**Leads** `/vendors/leads` — pipeline New → Contacted → Documents requested → Qualified → Converted/Dropped. `Start onboarding` on Qualified opens the wizard prefilled.

**Market gap** `/vendors/market-gap` — per branch: lane under pressure, truck needed, editable target, on panel, converted, gap, progress. Where `D-19` lands: a band that draws no in-band quote is a recruitment problem, never a licence to widen the band.

**Issues** `/vendors/issues` — category, severity, related LR, Open → In progress → Resolved.

---

## 4 · Compliance desk — `/compliance` · `COMPLIANCE`

One queue, three segments with pending counts.

| Segment | Contents | Action |
|---|---|---|
| **Vendor files** | Identity checks and legal documents item by item | Verify each · **Clear and activate** (enabled only on a complete file) |
| **Client contracts** | Agreement, validity, lanes priced | Approve. Warns when no rate card lanes exist |
| **Trip documents** | Grouped **vehicle · driver · client** (`D-09`) | Verify · Verify all · what is not yet attached called out |

The trip documents segment operates on part 05's data and gates part 07's advance. It is built here because the queue is one screen; the documents themselves arrive at C4.

---

## 5 · Identity data handling — `NFR-04`

- Aadhaar stored as **last four digits only** (`BR-04`), enforced by the column constraint in part 02 §6
- Identity images encrypted at rest, access restricted to `COMPLIANCE`, signed URLs at 15-minute expiry
- Retained for the life of the relationship (`BR-46`, `D-27`), then deleted by the `identity-image-purge` job (part 13, `R-04`)

---

## 6 · Advance policy changes — `BR-57`

The percentage agreed at step 4 is a **standard maintained by compliance**. Any later change raises `ADVANCE_POLICY_CHANGE` and is not applied until approved by a role senior to operations. Every change writes a `vendor_advance_history` row carrying the old value, the new value, the approval and the actor, and an `audit_events` row.

The indent-level departure from this standard is part 04's half of the same rule.

---

## 7 · Done when

- [ ] A vendor with any mandatory KYC item missing cannot be activated, by API or by import
- [ ] An Owner without an RC cannot be submitted; a Vendor without any legal document cannot either (`BR-02`)
- [ ] No TDS declaration → no submission, whatever the party type (`BR-03`)
- [ ] Full Aadhaar number is nowhere in the database (`BR-04`, `NFR-04`)
- [ ] Verification route and verifier recorded on every check, and not repeated per load (`BR-31`)
- [ ] Two branches within 150 km → the override is recorded with a reason (`BR-34`, `BR-47`)
- [ ] Advance policy change returns `202` and does not apply until approved (`BR-57`)
- [ ] Activation creates the portal account and sends the SMS

**Tests** (part 13 §23): 13, 18.
