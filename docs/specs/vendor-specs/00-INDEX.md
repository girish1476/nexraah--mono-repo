# Vendor Portal — build parts

**Source:** `docs/specs/SPEC-1-vendor-portal-fullstack_1.md` v1.1, split into buildable parts.
**Authority:** `docs/FSD/Nexraah-FSD-v2.2.md`. Every `BR-`, `NFR-`, `D-`, `R-`, `ACT-`, `MOD-` identifier resolves there.
**Companion:** `docs/specs/internal-spec/00-INDEX.md` — the internal console, a separate application (`ADR-01`).

These parts are canonical for building. `SPEC-1-vendor-portal-fullstack_1.md` remains the single-file narrative and is not edited further — if the two disagree, a part file wins and the whole-file version is stale.

> **The rule this whole application exists to protect.** A transporter must never learn who our client is, what we charge them, or what anyone else quoted. It is `NFR-02`, `BR-55`, `D-38`, and every part below defers to it. Part 02 is not a feature; it is the reason the other parts are safe.

---

## The parts

| Part | Wave | Covers | Depends on |
|---|---|---|---|
| [01 · Foundation](01-P1-foundation.md) | **P1** | Architecture, `vendor_api` DB role, auth and provisioning, session, `PortalGuard`, repository scoping, suspension, rate limiting | — |
| [02 · Redaction contract](02-redaction-contract.md) | **P1** | The DTOs, the four enforcement layers, the isolation test suite. **Build and test this before any screen** | 01 |
| [03 · Loads & quotes](03-P2-loads-quotes.md) | **P2** | Available loads, place a quote, band verdict, my quotes, withdraw | 02 · console `C2`, `C3` |
| [04 · Fleet](04-P3-fleet.md) | **P3** | Fleet inventory, `DOCS_DUE`, availability that gates quoting | 02 |
| [05 · Trips & lorry receipt](05-P4-trips-lr.md) | **P4** | Trip list, what is owed, the redacted LR, barcode, signed PDF | 02 · console `C4` |
| [06 · POD attachment](06-P5-pod-attachment.md) | **P5** | File attach, courier docket, sent-on, the clock, rejection and re-attach | 05 · console `C5` |
| [07 · Raise your bill](07-P6-vendor-bill.md) | **P6** | Transporter's own bill, reverse-charge declaration, blocked until POD approved | 06 · console `C5`+`C6` |
| [08 · Profile & KYC](08-P7-profile-kyc.md) | **P7** | Company details, KYC and legal documents, card capture, re-upload on rejection | 02 · console `C2` |
| [09 · Mobile shell](09-P8-mobile-shell.md) | **P8** | Expo wrapper, native capture, push. **Blocked — needs a change request against FSD `B1`** | 08 |
| [10 · Notifications](10-notifications.md) | P2 onward | Nine DLT templates, triggers, channels | 01 |
| [11 · Cross-cutting](11-cross-cutting.md) | all | Full endpoint index, NFR obligations, error catalogue, testing, done-when checklist | — |

**P1 before anything else.** Build the redaction contract and its tests first, so every screen after it inherits a payload that is already safe. Retrofitting redaction is how the first version leaked.

---

## Cross-app dependencies

The portal reads what the console writes. It cannot be built ahead of the waves that produce its data.

| Portal wave | Needs | Why |
|---|---|---|
| `P1` | `C1` | Schema, both DB roles, `attachments`, audit. Written in one migration |
| `P2` | `C2`, `C3` | Vendor activation creates the account (`BR-01`); indents and the bid band must exist to quote against |
| `P3` | `C2` | `vendor_fleet` belongs to an onboarded vendor |
| `P4` | `C4` | Trip and lorry receipt |
| `P5` | `C5` | The receiving register. **Attachment alone stops no clock** (`D-35`) — without the branch side, `P5` shows a clock nothing can stop |
| `P6` | `C5` + `C6` | POD must reach `APPROVED` and the balance must be computable |
| `P7` | `C2` | KYC and document records, and the compliance queue that verifies them |
| `P8` | `P7` | Wraps finished screens. Also blocked on scope — see part 09 |

---

## Rule coverage

Rules this application owns, and rules it merely displays. Displaying one still needs the copy right — a transporter who cannot see why ₹400 was deducted disputes it.

### Enforced here

| Rule | Subject | Part |
|---|---|---|
| `BR-05` | Below-band refused at entry; above-band accepted and flagged (`D-39`) | 03 |
| `BR-23` | PAN and Aadhaar card photographs mandatory | 08 |
| `BR-51` | POD attach requires courier docket and sent-on date | 06 |
| `BR-53` | Bill only after POD approved; variance flagged, not rejected | 07 |
| `BR-54` | LR visible and downloadable, redacted | 05 |
| `BR-55` | Redaction by construction, not by interface suppression | 02 |
| `NFR-02` | A transporter never sees another transporter's anything | 01 · 02 |
| `NFR-06` | Phone-first — most transporters will never open a laptop | 11 |

### Displayed, enforced by the console

| Rule | What the portal must show | Part |
|---|---|---|
| `BR-01` | Account exists only because compliance cleared the file | 01 |
| `BR-22` | Share is optional — never a required step | 05 |
| `BR-24` · `BR-25` | ₹100/day from day 21; nothing paid past 40 days | 06 |
| `BR-27` · `BR-28` | Transit days and remarks carried onto the load and the LR | 03 · 05 |
| `BR-30` | The advance % on offer | 03 |
| `BR-42` | Reporting rule, and that failing it is a transit delay | 03 |
| `BR-48` · `D-32` | The chain, with the transporter's own step first | 06 |
| `BR-49` · `D-35` | **The clock stops at branch receipt, not at attachment** | 06 |
| `BR-52` | A rejected POD does not stop the clock | 06 |
| `BR-58` | Which vehicle documents gate the advance | 08 |

---

## Conventions every part follows

**Redaction is a payload property, not a rendering choice.** A field absent from the DTO cannot leak. A field the `vendor_api` role holds no `GRANT` on cannot be selected at all. Both, always (part 02).

**Money** is `bigint` paise everywhere — API, database, computation (`NFR-09`). `₹` formatting is presentation only.

**Never confirm existence.** A request for another vendor's record returns **404, not 403**. A 403 tells the caller the record is real.

**Rejection never says why someone else won.** A rejected quote shows no winning price, no quote count, no competitor. `BR-55` is as much about the copy as the payload.

**The transporter carries the risk the screen explains.** Wherever money moves against them — the penalty clock, a forfeited balance, a variance on their bill — the screen states the rule in plain words before the number arrives. Hiding it makes the first deduction feel arbitrary and generates the dispute the platform exists to avoid.

**Every part ships its tests.** A rule without a passing e2e test is not done. The isolation suite (part 02 §4) runs on **every deploy**, not every release.

---

## Repo layout these parts build into

```
apps/vendor-portal/src/app/<route>/   page.tsx · apis.ts · types.ts
apps/vendor-api/src/<module>/         controller · service · dto · repository
packages/*                            shared types and enums only, no runtime
```

Frontend convention is the root `README.md`: root axios instance in `src/apis.ts`, jotai atoms in `src/store/`, page-scoped `apis.ts` and `types.ts`. All API paths sit under the `vendor-api` global prefix `/api/v1`, so `GET /portal/loads` is served at `http://localhost:4001/api/v1/portal/loads`.
