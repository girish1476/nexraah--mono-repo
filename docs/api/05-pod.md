# 05 · Proof of delivery — wave C5

Five states plus `FORFEITED` (`BR-48`). The chain is the deadline the FSD's third leak lacks.

Frontend: `src/app/pod/apis.ts` · `src/app/pod/types.ts`

---

## The chain

| State | Set by | Clock | Endpoint |
|---|---|---|---|
| `PENDING` | System, on delivery | **running** | — |
| `ATTACHED` | Transporter, in their portal | **still running** (`BR-49`) | Spec 1 |
| `RECEIVED` | Branch · `pod.receive` | **stopped** | `POST /pod/:tripId/receive` |
| `VERIFIED` | Branch or compliance · `pod.verify` | stopped | `POST /pod/:tripId/verify` |
| `APPROVED` | Branch or compliance · `pod.approve` | stopped | `POST /pod/:tripId/approve` |
| `FORFEITED` | System, day 41 | — | `pod-ageing` job |

`PENDING` is a real state, not an absence — the chase list, the penalty accrual and the `pod.due` / `pod.breached` notifications all operate on it.

**Attachment does not stop the clock. Branch receipt does.** If a photograph stopped it the paper would never arrive, so the transporter carries the risk of a slow courier (`D-35`).

### Penalty

| Position | Treatment |
|---|---|
| 0–20 days | Within turnaround. Balance held, no penalty |
| 21–40 | Breached (`BR-12`). ₹100/day **on actuals** from day 21, deducted from the balance (`BR-24`) |
| Beyond 40 | **Nothing is payable.** Balance forfeited, trip closed, reported against the transporter's file (`BR-25`) |

Recomputed nightly by `pod-ageing` from `pod_received_at` — which is why rejection clearing that field matters.

---

## `GET /pod/receiving`

**Permission** — `pod.receive` to act; visible more widely. **Query** — `branch`.

```json
{
  "stats": {
    "attachedInTransit": 2, "receivedToday": 1,
    "awaitingVerification": 1, "awaitingApproval": 0,
    "balanceHeldPaise": 13704000, "pastTwentyDays": 2
  },
  "rows": [{
    "tripId": "t-120881", "tripCode": "TRP-120881", "lrCode": "LR-88214",
    "vendorName": "Rathod Roadlines", "lane": "Nashik → Kolkata",
    "deliveredAt": "…", "courierDocket": null, "attachedAt": null,
    "ageDays": 24, "podStatus": "PENDING", "balanceHeldPaise": 5840000
  }]
}
```

## `POST /pod/:tripId/receive`

**Permission** — `pod.receive`.

```json
{ "courierDocket": "BD-77120441", "sentOn": "2026-08-02", "receivedOn": "2026-08-09",
  "pages": 2, "receivedBy": "Sunita Rao", "condition": "Slightly torn at the fold" }
```

Consumes the `PDR-` series, **scoped per branch**. Sets `podStatus: RECEIVED` and `podReceivedAt`. `400` without a docket.

**Response** — the receipt: `{ id, code: "PDR-0771", tripId, courierDocket, sentOn, receivedOn, pages, receivedBy, condition }`

---

## `GET /pod/:tripId`

```json
{
  "tripId": "t-120881", "tripCode": "TRP-120881", "lrCode": "LR-88214",
  "vendorName": "Rathod Roadlines", "clientName": "Berger Paints",
  "lane": "Nashik → Kolkata", "deliveredAt": "…",
  "podStatus": "RECEIVED", "podReceivedAt": "…",
  "ageDays": 24, "penaltyPaise": 40000,
  "receipt": { "code": "PDR-0771", "courierDocket": "BD-77120441", "…": "" },
  "pages": 2,
  "attachmentIds": ["att-pod-1", "att-pod-2"],
  "verifiedBy": null,
  "approvedBy": null,
  "charges": []
}
```

**`verifiedBy` must be the verifier's `userId`, not their display name.** The approve button is withheld when it equals the signed-in user's id — that is the presentation half of `BR-50`.

---

## `POST /pod/:tripId/verify`

**Permission** — `pod.verify`.

```json
{
  "checklist": {
    "consigneeStamp": true,
    "signedAndDated": true,
    "lrNumberMatches": true,
    "quantityMatchesInvoice": true,
    "noShortageOrDamage": false
  },
  "remarks": "Two drums recorded as dented by the consignee.",
  "charges": [
    { "chargeType": "UNLOADING", "costAmountPaise": 140000, "billedAmountPaise": 175000 }
  ]
}
```

- `400 REMARKS_REQUIRED` when any check is `false` and `remarks` is empty.
- `409 NOT_RECEIVED` unless the trip is `RECEIVED` — the physical copy must be logged first (`BR-49`).
- **Charges are captured here** (`BR-56`), because verification is the moment someone is actually reading the document. They land in `trip_charges` exactly as `POST /trips/:id/charges` would.

## `POST /pod/:tripId/reject`

**Body** — `{ "reason": "…" }`, mandatory.

Returns the POD to `ATTACHED` (or `PENDING` where the copy is not coming back) and **clears `pod_received_at`** — rejection does not stop the clock (`BR-52`).

> **Open for business sign-off.** Clearing the field means the days between receipt and rejection re-enter the accrual. This spec backdates. The alternative — accrual resumes from the rejection date — is defensible and costs the transporter less. Rule before C6 releases a balance carrying a penalty. The frontend renders whatever `penaltyPaise` the server returns and takes no position.

## `POST /pod/:tripId/approve`

**Permission** — `pod.approve`.

- `409 NOT_VERIFIED` unless the POD is `VERIFIED`.
- `409 APPROVER_IS_VERIFIER` when the caller verified it (`BR-50`).

**Enforced three ways:** the database constraint `CHECK (approved_by IS NULL OR approved_by <> verified_by)`, the service check, and the button not rendering. Three layers, because this is the one rule a determined branch will try to work around at 6pm.

Approving unblocks the balance. **Finance still releases it** (`BR-10`, `BR-40`).

---

## `GET /pod/pending`

**Query** — `branch`, `transporter`, `ageing` (`within · breached · forfeited`). Oldest first.

```json
{
  "stats": { "pending": 3, "breached": 2, "penaltyAccruedPaise": 150000, "balanceHeldPaise": 9744000 },
  "rows": [{
    "tripId": "t-120874", "tripCode": "TRP-120874", "lrCode": "LR-88207",
    "vendorName": "Sai Kripa Carriers", "clientName": "Berger Paints",
    "lane": "Pune → Surat", "branchName": "Pune",
    "deliveredAt": "…", "ageDays": 31, "daysLeft": -11,
    "podStatus": "ATTACHED", "penaltyPaise": 110000,
    "balanceHeldPaise": 1116000, "forfeited": false
  }]
}
```

`daysLeft` is negative once breached; the screen renders `+11d over`. `forfeited` is `true` past the configured forfeit window.

## `GET /pod/pending/export.csv`

Honours the active filters. Linked with a bare `<a href>` — see conventions §9 about authenticating it.

---

## `POST /pod/:tripId/waive`

**Permission** — `pod.waive` (compliance proposes). **Body** — `{ "reason": "≥ 30 characters" }`

**Always `202 PENALTY_WAIVER`**, approved by `LEADERSHIP` (`BR-43`, `D-23`). Never waived at the desk. `400 REASON_TOO_SHORT` below 30.

A waived penalty computes as **zero** in the balance. The transporter-facing view of an accruing or waived penalty is Spec 1's — a penalty waived here must not still read as accruing there.

---

## Done when

- [ ] A delivered trip lands at `PENDING` automatically, with the clock running
- [ ] Attachment leaves the clock running; `receive` stops it (`BR-49`)
- [ ] Penalty accrues from day 21 at ₹100/day on actuals, recomputed nightly (`BR-24`)
- [ ] Day 41 sets `FORFEITED` and closes the trip with nothing payable (`BR-25`)
- [ ] Rejection returns the POD and restarts accrual (`BR-52`)
- [ ] The verifier cannot approve their own POD — refused at the service **and** by the constraint (`BR-50`)
- [ ] A waiver under 30 characters is refused; over 30 raises `202` and only leadership can approve (`BR-43`)
- [ ] Charges are captured at verification, not as a separate later step (`BR-56`)
