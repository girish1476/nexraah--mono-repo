# Verification — FSD vs the specs

**Audited** 10 August 2026 · **Closed** 10 August 2026
**Sources** `docs/FSD/Nexraah-FSD-v2.1.pdf` (41 pages, historical record) → transcribed and corrected as `docs/FSD/Nexraah-FSD-v2.2.md` (canonical) · `SPEC-1-vendor-portal-fullstack_1.md` (v1.1) · `SPEC-2-internal-console-fullstack.md` (v1.1)

---

## 0 · Status

Twenty-eight findings. **All closed.**

| Kind | Found | Closed in |
|---|---|---|
| Spec 2 contradicts the FSD | 5 | Spec 2 v1.1 |
| Spec 2 omits an FSD requirement | 14 | Spec 2 v1.1 |
| The FSD contradicts itself | 9 | FSD v2.2 |

One finding needed a business answer rather than an edit — whether an above-band quote is refused or routed to leadership. It is resolved as **`D-39`**: refused below band, accepted and flagged above it, leadership approval to award. Rationale is in the FSD; the short version is that discarding above-band quotes destroys the only evidence that a band is set below the market, which is the signal `D-19` needs to declare a market gap.

The FSD markdown is now the canonical reference: every `BR-`, `NFR-`, `D-`, `R-`, `ACT-`, `MOD-` and `PERM-` identifier resolves there, and its Document control carries an identifier index.

---

## 1 · Contradictions (5) — closed

| # | Finding | Resolution |
|---|---|---|
| **S-01** | **HIGH.** Spec 2 §12.1 gated the advance on `CLIENT_INVOICE, EWAY_BILL, RC, INSURANCE, DL`. FSD A5 also names **fitness, permit, PUC** — and an expired fitness certificate is one of the FSD's own examples of Leak 2. Spec 1 §4.8 already tracked all four at fleet level | New **`BR-58`** names the eight-document set. Spec 2 §10.3 enumerates it per group, §12.1 gates on it, §17.1 makes it configurable, §23 test 2 proves each of the three added documents blocks alone |
| **S-02** | **MEDIUM.** Spec 2 §11 stated a four-state chain; `BR-48`/`D-32` define five. `Pending` — delivered, nothing submitted — is the state the entire chase list runs on | Spec 2 §11 now carries all six rows including `PENDING` and `FORFEITED`, with owner and clock state per row. Spec 1 §4.6 notes why the transporter sees four steps and the system holds five |
| **S-03** | **MEDIUM.** *"not phone-optimised"* is a narrower claim than `NFR-06` allows | Spec 2 header and §19 now: usable on a phone throughout, phone-*optimised* on Today, POD and approvals — the three used away from a desk. Tables collapse below 768px |
| **S-04** | **LOW.** *"The band is immutable after the first quote"* left the desk free to widen it before one arrives, which is the tempting window. `BR-39` is unqualified | Spec 2 §9.2: never widened, before or after; `bid_min`/`bid_max` read-only from publication. FSD B3.9 restated to match. Test 14 |
| **S-05** | **LOW.** Screen-level "no tax fields" is right, but FSD B5 keeps nil tax columns on the entity and Spec 2 had no data model for that to land in | Spec 2 §14.1 and §20.5 keep `tax_mechanism` + nil `cgst/sgst/igst`, so `D-26`'s later forward-charge entity is configuration, not migration |

---

## 2 · Omissions (14) — closed

| # | Finding | Resolution |
|---|---|---|
| **S-06** | **HIGH.** §12 Payments had no endpoints and no route — the only module without an interface contract, and the one wave C6 builds | Spec 2 §12 rewritten: `/payments/advance`, `/balance`, `/bills` routes, ten endpoints in §12.4, `409` shapes, and `Idempotency-Key` on every release |
| **S-07** | **HIGH.** No schema anywhere, though Spec 1 §5.2 promised *"Full DDL in the internal spec"* | Spec 2 §20 — five subsections covering FSD B5's thirteen entities plus the operational tables. Spec 1 §5.2 repointed |
| **S-08** | **HIGH.** `NFR-12` requires controlled import of the panel, client master and opening balances at go-live. Nothing specified it | Spec 2 §17.4 + `/admin/import` route + wave C11. Import can never set a vendor `ACTIVE` — `BR-01` is not bypassable by CSV (test 18) |
| **S-09** | **HIGH.** `NFR-03` names four event classes; Spec 2 mentioned audit twice, once scoped to the roles matrix | Spec 2 §18 — table DDL, ten-row coverage matrix, immutability enforced by grant and trigger rather than by convention. Audit moved into wave C1 |
| **S-10** | **MEDIUM.** Four FSD B7 integrations absent: NIC e-way (High), banking, accounting, GSTN | Spec 2 §21 covers all eight with wave and approach. Banking split: UTR reconciliation first, payment initiation out of scope — reconciliation catches the mis-keyed UTR, which is the failure that actually happens |
| **S-11** | **MEDIUM.** `D-22` requires approval for any advance-percentage departure; no approval kind existed and `PATCH /advance-policy` was an unguarded edit | New **`BR-57`**; sixth kind `ADVANCE_POLICY_CHANGE` in Spec 2 §3, wired into §6.1 and §9.1. Test 13 |
| **S-12** | **MEDIUM.** Three of nine number series configurable; `NFR-08`'s concurrency half unspecified | Spec 2 §17.1 — all nine with scope, plus `SELECT … FOR UPDATE` issuance inside the creating transaction and the reason numbers are never pre-allocated to a draft. Test 15 |
| **S-13** | **MEDIUM.** FSD B6 print requirements (CIN, Code 39, three signature blocks, authorised signature) unspecified | Spec 2 §10.5 and §14.2 carry full print layouts |
| **S-14** | **MEDIUM.** `pod.receive/verify/approve` used but never assigned to a role | Spec 2 §2.4 — twelve seed grants with movability. Finance holds View on the chase list without holding any POD permission |
| **S-15** | **MEDIUM.** `NFR-05`, `07`, `09`, `10`, `11` unaddressed. `NFR-09` was urgent: Spec 1 declared paise, Spec 2 said nothing | Spec 2 §19 answers all twelve. **Money is `bigint` paise everywhere**, rupee rounding once at the invoice total. Retention resolved at 8 years (income-tax governs over GST's 6) |
| **S-16a** | **LOW.** `BR-06` — nothing stated that awarding writes the buy price | Spec 2 §9.2 states it and names why (FSD A9 §3). Audited per §18. Test 7 |
| **S-16b** | **LOW.** `BR-09` "mode" missing from the capture set | Added to §9.2 and §12; `NOT NULL` in §20.6 |
| **S-16c** | **LOW.** `BR-03`, `BR-20`, `BR-47` never cited | Now cited in §6.1 and §9.1 with their full clauses |
| **S-16d** | **LOW.** Vendor margin missing; `/rfq/new` and payments routes missing from the tree; *"Full visibility matrix: Spec 5 §1.5"* pointed at a document that does not exist | §6.2 adds margin per vendor and per lane; §1.1 adds the routes; §2.1 points at FSD B2 |

---

## 3 · FSD self-contradictions (9) — closed in v2.2

Each is listed with its original wording at the head of `Nexraah-FSD-v2.2.md`, so nothing was changed silently. The v2.1 PDF stays the historical record.

| # | Defect | Fix |
|---|---|---|
| **F-01** | B9 claimed *"Thirty-one decisions… No open points remain"* while document control claimed thirty-eight were recorded there. `D-32`–`D-38` — the seven decisions defining the whole POD chain — were in the revision history only | Added to B9 as a third table. Counts corrected to thirty-nine |
| **F-02** | Document control named an open question; B9 asserted none existed; Spec 1 cited it as `Q-16`, which appeared nowhere | Resolved as `D-39`. `BR-05` rewritten. Spec 1 §4.2 closed |
| **F-03** | B3.6: *"Uploading the POD marks it received and releases that trip's balance payment"* — contradicted `D-32`, `D-35`, `BR-49` and `BR-10` at once | Sentence removed, correct chain behaviour stated. Surviving v2.0 text |
| **F-04** | B1, A6 and B3.12 all still described GST on invoices, against `D-06`, `D-26`, `BR-15` | All three corrected to reverse charge. Spec 2 §17.1 additionally explains why no GST-rate setting exists |
| **F-05** | Module count given as eleven, twelve and fourteen in three places | Fourteen throughout; thirteen internal |
| **F-06** | Permission matrix had no `ADMIN` column and a Control panel row of `—` for everyone — nobody could configure the system — plus no rows for POD, RFQ, Clients, Leads or Telematics | Matrix reissued with `ADMIN` and all missing rows, and notes on the POD permission split |
| **F-07** | `BR-47`, `BR-18`, `BR-19`, `BR-20` listed after `BR-56` | Reordered. Nothing renumbered |
| **F-08** | `D-07` and `D-13` shown without superseded markers | Both struck through and marked **do not build to this** |
| **F-09** | A9 §5 referenced `OP-04`/`OP-05`; no `OP-` register exists | Repointed to `R-01` and `R-03` |

**New in FSD v2.2:** `D-39`, `BR-57`, `BR-58`. **Amended:** `BR-05`, `BR-07`, `NFR-09`. Catalogue is now `BR-01`–`BR-58`, none missing.

---

## 4 · Repository alignment

Resolved separately as **`ADR-01`**, then re-decided as **`ADR-02`**: four processes (`internal-portal` 3002, `internal-api` 4002, `vendor-portal` 3001, `vendor-api` 4001), Next.js 14, jotai + axios, react-hook-form + zod installed at first-wizard wave — but only **one** backend. `internal-api` owns every operation and serves `/api/v1/portal/*`; `vendor-api` is a proxy with no database credentials.

`ADR-01` gave the vendor side its own backend. That was stronger for the redaction contract than the single-app-with-route-groups shape the specs originally described, and it was also two implementations of every rule spanning both sides — `BR-05`, `BR-23`, `BR-51`, `BR-53` were each specified twice, in two processes, with no test spanning both. `ADR-02` collapses the backend and keeps the redaction guarantee by binding `/portal/*` handlers to a second connection pool authenticated as `vendor_api`: `BR-55` stays *"the credential cannot read the column"* rather than reverting to *"we remembered to redact"*.

**Neither ADR is an FSD requirement.** FSD v2.2 mandates redaction at the source (`NFR-02`, `BR-55`, `D-38`) and names no topology, which is why this was re-decidable at all. The FSD rule is unchanged and still binding either way. Spec files still carrying the `ADR-01` shape are marked stale in place; `docs/adr/ADR-02-internal-owns-operations.md` is authoritative.

One item remains open and is tracked in Spec 1 §1.3, not here: the **Expo shell (`P8`) is out of FSD `B1` scope** — *"The transporter portal is web only in version one"* — and needs a change request before it ships. §2–§7 of Spec 1 work as responsive web with no shell present.

---

## 5 · What to build first

Unchanged by this audit, and now unblocked:

1. **C1** — auth, roles, permissions, audit (§18), numbering (§17.1), attachments, approvals engine, and the schema with both DB roles in one migration
2. **C2** — vendors and compliance; `BR-01` gates the supply side
3. **C5 + C6** — the POD chain and both money gates. This is the spine; everything before it is scaffolding for it

Run C1→C6 on one branch against current practice before extending. A platform trusted on six screens beats one ignored on thirteen.
