# 10 · Telematics and go-live import — waves C10 · C11

Frontend: `src/app/telematics/apis.ts` · `src/app/admin/import/apis.ts`

---

# Telematics

## `GET /telematics`

The live fleet board. The portal polls it every 30 seconds.

```json
{
  "config": { "overspeedKmph": 80, "haltMinutes": 90, "darkVehicleIntervalMinutes": 120 },
  "vehicles": [{
    "vehicleNo": "MH 04 TT 2019",
    "tripCode": "TRP-120869",
    "vendorName": "Bhagwati Logistics",
    "lane": "Hosur → Gurugram",
    "progressPct": 82,
    "speedKmph": 91,
    "fuelPct": 58,
    "lastPingAt": "…",
    "lat": 26.9124, "lng": 75.7873,
    "ewayValidTill": "…",
    "alerts": ["OVERSPEED", "EWAY_EXPIRING"]
  }]
}
```

`alerts[]` ∈ `OVERSPEED · LONG_HALT · DARK_VEHICLE · EWAY_EXPIRING · EWAY_EXPIRED` (`BR-19`).

**Alerts are derived server-side.** The `config` block is echoed only so the screen can say what the thresholds currently are.

**Thresholds come from the control panel and re-evaluate immediately on change** — changing the overspeed limit re-evaluates the live board, it does not wait for the next ping. That is a stated FSD behaviour (A6 Control), not an optimisation.

---

## `POST /telematics/ping` — **not called by the portal**

The provider's webhook. HMAC-signed over the raw body with a shared secret in `config`; **no JWT**.

Rejects on signature mismatch, clock skew beyond 5 minutes, or a `vehicle_no` not on any open trip. Every accepted ping lands in `telematics_pings`; alerts are derived on ingest and again every 15 minutes by the `telematics-alerts` job.

Until a provider is connected the board runs against simulated pings.

---

## E-way expiry

`eway-expiry` runs hourly, warns inside `config.eway_warning_window_hours` and expires past `trips.eway_valid_till`. **It is a hard expiry — there is no grace.** A truck detained at a checkpost on a lapsed e-way bill is the failure this exists to prevent.

Connecting NIC replaces the keyed validity with a fetched one and also makes the `BR-32` vehicle-number cross-check authoritative rather than typo-prone.

---

## Notifications — the dispatcher, not an endpoint

No screen calls these. The events this side raises (part 11 §4):

| Event | Trigger | Channel |
|---|---|---|
| `vendor.activated` | `POST /vendors/:id/activate` | SMS |
| `load.published` | New indent matching a vendor's states and fleet | SMS |
| `quote.awarded` | Award completes | SMS + push |
| `lr.released` | LR issued — **only where the transporter asked for electronic sharing** (`BR-22`) | WhatsApp with document |
| `pod.due` | Day 15 | SMS |
| `pod.breached` | Day 21, then weekly | SMS |
| `pod.rejected` | Verification fails | SMS + push |
| `pod.forfeit_warning` | Day 35 | SMS |
| `payment.released` | Advance or balance released | SMS with UTR |
| `approval.raised` · `approval.decided` | Approvals engine | In-app |
| `bill.queried` | Finance queries a transporter bill | SMS |

Every message is transactional under the DLT registration. **No promotional templates.** A failed send retries; it never silently drops.

---

# Go-live import

`:set` ∈ `clients · vendors · opening-balances`. **Permission** — `config.manage`.

```
upload → dry-run report → confirm → commit
```

## `POST /admin/import/:set`

`multipart/form-data`, field `file`. **Nothing is written.**

```json
{
  "id": "imp-1723…",
  "set": "vendors",
  "fileName": "vendors-2026-08.csv",
  "fileHash": "d2a84f4b8b650937",
  "rows": 214,
  "rejected": 3,
  "actor": "S. Krishnan",
  "committedAt": null,
  "status": "DRY_RUN",
  "report": {
    "rowCount": 214,
    "rejects": [
      { "row": 41,  "reason": "status=ACTIVE downgraded to PENDING_VERIFICATION (BR-01)" },
      { "row": 88,  "reason": "TDS declaration missing (BR-03)" },
      { "row": 190, "reason": "Duplicate phone number" }
    ],
    "controlTotals": null
  }
}
```

For `opening-balances`, `controlTotals` is `{ suppliedPaise, computedPaise, reconciles }`. **A mismatch aborts the entire import** and the commit button stays disabled.

## `POST /admin/import/:set/commit`

**Body** — `{ "batchId": "imp-1723…" }`

**All inside one transaction.** A partial import is not a state this system has. Audited as a **single event carrying the file hash** (class `IMPORT`).

## `GET /admin/import/history`

Batches with actor, file hash, row counts and status (`DRY_RUN · COMMITTED · ABORTED`).

---

## The three sets and their order

They are dependent and must import in this order. Out of order fails the dry run with the missing dependency named.

1. **Clients** — the synthetic closed RFQ and its lanes must exist before any rate card line, so `rate_card_lanes.rfq_lane_id NOT NULL` stays satisfiable (`BR-37`).
2. **Transporter panel** — vendors, KYC state, advance policy, bank details, fleet. **Every row lands at `PENDING_VERIFICATION` at most; an import can never set `ACTIVE`.** `BR-01` is not bypassable by CSV, and a transporter cleared by spreadsheet is exactly the hole the platform exists to close.
3. **Opening balances** — outstanding advances, unbilled trips, open invoices and their ageing, reconciled to a control total.

Every imported row carries `source = 'IMPORT'` and the batch id, so a bad batch is identifiable and reversible after the fact. `attachments.sha256` exists partly for this — a re-run of the same file is recognisable rather than duplicated.

---

## Done when

- [ ] All five alert kinds raise against configured thresholds (`BR-19`)
- [ ] Changing a threshold in `/admin` re-evaluates the live board immediately
- [ ] `POST /telematics/ping` rejects an unsigned, mis-signed or stale request
- [ ] `lr.released` sends only where sharing was requested (`BR-22`)
- [ ] An import row claiming `status = ACTIVE` lands at `PENDING_VERIFICATION` and the report says so
- [ ] An opening-balance file whose control total does not reconcile aborts the whole import, writing nothing
- [ ] Dry run writes nothing, ever; commit is one transaction
- [ ] The audit row carries the file hash and the batch id
