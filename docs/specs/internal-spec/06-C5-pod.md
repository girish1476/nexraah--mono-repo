# Part 06 · Proof of delivery — wave C5

| | |
|---|---|
| **Wave** | C5 — the first half of the second money gate |
| **Depends on** | 05 (a POD hangs off a delivered trip) |
| **Rules owned** | `BR-12`, `BR-24`, `BR-25`, `BR-43`, `BR-48`, `BR-49`, `BR-50`, `BR-52`, `BR-56`, `BR-51` (internal half) |
| **Screens** | `/pod/receiving`, `/pod/[id]/verify`, `/pod/pending` |
| **Module** | `MOD-POD` · **Actors** branch, compliance |

> **Leak 3.** Goods are delivered but the signed proof stays in a driver's cab. Without it the client will not accept the invoice. Nobody owns the chase, and there is no deadline against which a POD is formally late. This part is that deadline.

---

## 1 · The chain — `BR-48`, `D-32`

Five states, plus **Forfeited** terminal outside the chain past 40 days.

| State | Set by | Clock | Meaning |
|---|---|---|---|
| `PENDING` | System, on delivery | **Running** | Delivered; the transporter has submitted nothing. Every chase-list row starts here |
| `ATTACHED` | Transporter, in the portal | **Still running** (`BR-49`) | Photo or PDF uploaded with courier docket and sent-on date (`BR-51`) |
| `RECEIVED` | Branch · `pod.receive` | **Stopped** | The physical copy arrived and was logged against its docket (`D-35`) |
| `VERIFIED` | Branch or compliance · `pod.verify` | Stopped | Clerical check passed. Charges captured here (`BR-56`) |
| `APPROVED` | Branch or compliance · `pod.approve` | Stopped | The decision to pay. **Only this unblocks the balance** (`BR-10`). Approver ≠ verifier (`BR-50`) |
| `FORFEITED` | System, day 41 | — | Terminal. Balance forfeited, trip closed with nothing payable (`BR-25`) |

`PENDING` is a real state, not an absence. The chase list, the penalty accrual and the `pod.due` / `pod.breached` notifications all operate on `PENDING` rows, so a state machine built without it has no initial state.

**Attachment does not stop the clock. Branch receipt does** (`BR-49`, `D-35`). If a photograph stopped the clock the paper would never arrive, and the transporter therefore carries the risk of a slow courier. Spec 1 §4.6 is required to say so on the transporter's screen.

### 1.1 The penalty — `BR-12`, `BR-24`, `BR-25`

| Position | Treatment |
|---|---|
| **0–20 days** | Within turnaround. Balance held pending the POD; no penalty |
| **21–40 days** | Breached (`BR-12`). ₹100 per day **on actuals** accrues from day 21 and is deducted from the balance payable (`BR-24`). The accrued figure shows on the chase list and on the trip |
| **Beyond 40 days** | **No payment is processed.** Balance forfeited, trip closed with nothing payable (`BR-25`). The closure and its basis are recorded against the trip and reported to the transporter's file |

Accrual is recomputed nightly by `pod-ageing` (part 13) from `pod_received_at`, which is why rejection clearing that field matters — see §3.

---

## 2 · Receiving register — `/pod/receiving` · `pod.receive`

The physical copy arriving by courier, days after attachment.

**Stats:** attached in transit · received today · awaiting verification · awaiting approval · balance held · past 20 days

**Table:** LR · trip · transporter · delivered · courier docket · attached · day (amber > 20, red > 40) · chain pill · action

**Log a receipt:** courier docket ● (auto-matches the trip) · received on ● · pages ● · received by ● · condition ○ → consumes the `PDR-` series, **per branch** (part 01 §4.1).

The register exists because an attached photograph and a signed physical copy are different things separated by roughly a week of courier time, and that week is where PODs are lost. A docket raised eight days ago with nothing arrived is visible here, and the branch chases the courier rather than the transporter.

---

## 3 · Verify and approve — `/pod/[id]/verify`

Two acts, two people (`BR-50`, `D-34`).

**Verify** · `pod.verify` — document viewer with page tabs; checklist: consignee stamp · signed and dated · LR number matches · quantity matches the invoice · no shortage or damage. Remarks mandatory when any check fails. **Charges captured here** (`BR-56`) — part 05 §4's form opens inside this screen, because verification is the moment someone is actually reading the document.

`Reject` returns it to the transporter for a replacement and **does not stop the clock** (`BR-52`) — it clears `pod_received_at` and returns the POD to `ATTACHED`, or to `PENDING` where the copy is not coming back.

> **Open for sign-off.** Clearing `pod_received_at` means the days between receipt and rejection re-enter the accrual. `BR-52` says rejection does not stop the clock; it does not say whether the stopped period is backdated. This spec backdates it. The alternative — accrual resumes from the rejection date — is defensible and costs the transporter less. Rule before C6 releases a balance with a penalty in it.

**Approve** · `pod.approve` — blocked until verification completes **and** the approver differs from the verifier. Enforced three ways: the database constraint (part 02 §6), the service check, and the button not rendering for the verifying user. Three layers, because `BR-50` is the one rule a determined branch will try to work around at 6pm.

Approving unblocks the balance; finance still releases it (`BR-10`, `BR-40`).

---

## 4 · Chase list — `/pod/pending`

Oldest first from the delivery date. TAT tag: `{n} days left` mint · `+{n}d over` red · `FORFEITED` red. Penalty accrued column. Shows the balance each missing POD is holding. Filters: branch · transporter · ageing. CSV export honouring filters.

**Waiver** — compliance requests with a reason ≥ 30 chars, leadership approves (`BR-43`, `D-23`). Never waived at the desk. The proposal, the approval and the reason are recorded against the trip. A waived penalty computes as zero in part 07's balance.

The transporter-facing view of an accruing or waived penalty is Spec 1's; a penalty waived here must not still read as accruing there.

---

## 5 · Endpoints

```
GET  /pod/receiving?branch=       · GET /pod/pending?branch=&transporter=&ageing=
POST /pod/:tripId/receive         pod.receive   → PDR-, stops the clock
POST /pod/:tripId/verify          pod.verify    { checklist, remarks, charges[] }
POST /pod/:tripId/reject          pod.verify    { reason } → clears pod_received_at
POST /pod/:tripId/approve         pod.approve   BR-50 enforced
POST /pod/:tripId/waive           pod.waive     { reason ≥ 30 } → 202 PENALTY_WAIVER
POST /pod/:tripId/waive/approve   LEADERSHIP
GET  /pod/pending/export.csv      honours filters
```

Every transition writes an `audit_events` row (part 01 §8.1).

---

## 6 · Done when

- [ ] A delivered trip lands at `PENDING` automatically, with the clock running
- [ ] Attachment leaves the clock running; `receive` stops it (`BR-49`)
- [ ] Penalty accrues from day 21 at ₹100/day on actuals, recomputed nightly (`BR-24`)
- [ ] Day 41 sets `FORFEITED` and closes the trip with nothing payable (`BR-25`)
- [ ] Rejection returns the POD to the transporter and restarts accrual (`BR-52`)
- [ ] The verifier cannot approve their own POD — refused at the service **and** by the constraint (`BR-50`)
- [ ] A waiver under 30 characters is refused; over 30 raises `202` and only leadership can approve (`BR-43`)
- [ ] Charges are captured at verification, not as a separate later step (`BR-56`)

**Tests** (part 13 §23): 3, 4, 5, 6.
