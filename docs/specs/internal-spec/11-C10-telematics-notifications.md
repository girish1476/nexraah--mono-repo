# Part 11 · Telematics and notifications — wave C10

| | |
|---|---|
| **Wave** | C10 |
| **Depends on** | 05 (alerts attach to trips in motion) |
| **Rules owned** | `BR-19` |
| **Screens** | `/telematics` |
| **Module** | `MOD-TEL` |

---

## 1 · Fleet board — `/telematics`

Live board with position along the route, speed, fuel, last ping and e-way bill validity.

**Alerts** (`BR-19`):

| Alert | Threshold |
|---|---|
| Overspeed | `config.overspeed_kmph` |
| Long halt | `config.halt_minutes` |
| No signal — dark vehicle | `config.dark_vehicle_interval` since last ping |
| E-way expiring | inside `config.eway_warning_window` |
| E-way expired | past `trips.eway_valid_till` |

**Thresholds come from the control panel and re-evaluate immediately on change** — changing the overspeed limit re-evaluates the live board, it does not wait for the next ping. That is a stated FSD behaviour (A6 Control), not an optimisation.

---

## 2 · Ingest

```
POST /telematics/ping     HMAC-signed provider webhook
```

Unauthenticated by JWT, authenticated by HMAC over the raw body with a shared secret in `config`. Rejects on signature mismatch, clock skew beyond 5 minutes, or a `vehicle_no` not on any open trip. Every accepted ping lands in `telematics_pings`; alerts are derived on ingest and again every 15 minutes by the `telematics-alerts` job (part 13).

Until a provider is connected the board updates on a timer against simulated pings — FSD A8 marks this 🟠 **Simulated** today. The GPS/telematics integration is High priority (part 13).

---

## 3 · E-way expiry

`eway-expiry` runs hourly (part 13), warns inside the window and expires past it. Until NIC is connected the validity is the value keyed on the trip document (`trips.eway_valid_till`); connecting NIC replaces the keyed value with a fetched one and also makes the `BR-32` vehicle-number cross-check authoritative rather than typo-prone (part 05 §3.1).

A truck detained at a checkpost on a lapsed e-way bill is the failure this exists to prevent, and it is a hard expiry — there is no grace.

---

## 4 · Notifications

`D-31` — DLT registration and TRAI approval are complete and a gateway is integrated. **What remains is registering the message templates and mapping events to them.** Without DLT no gateway integration is possible at all, so this is a solved dependency rather than an open one.

Every message is transactional under the DLT registration. **No promotional messages.**

The transporter-facing event list is Spec 1 §7. This part owns the dispatcher and the internal events:

| Event | Trigger | Channel |
|---|---|---|
| `vendor.activated` | Compliance clears the file (part 03) | SMS |
| `load.published` | New indent matching a vendor's states and fleet (part 04) | SMS |
| `quote.awarded` | Award completes (part 04) | SMS + push |
| `lr.released` | LR issued (part 05) | WhatsApp with document — **only where the transporter has asked for electronic sharing** (`BR-22`); sharing is never a required workflow step |
| `pod.due` | Day 15 (part 06) | SMS |
| `pod.breached` | Day 21, then weekly | SMS |
| `pod.rejected` | Verification fails | SMS + push |
| `pod.forfeit_warning` | Day 35 | SMS |
| `payment.released` | Advance or balance paid (part 07) | SMS with UTR |
| `approval.raised` · `approval.decided` | Approvals engine (part 01) | In-app to the approver and requester |
| `bill.queried` | Finance queries a transporter bill (part 07) | SMS |

Dispatch is by the continuous `notification-dispatch` job against the `notifications` table, which records template, payload, status and the provider reference. A failed send retries; it never silently drops.

---

## 5 · Done when

- [ ] All five alert kinds raise against configured thresholds (`BR-19`)
- [ ] Changing a threshold in `/admin` re-evaluates the live board immediately, without waiting for a ping
- [ ] `POST /telematics/ping` rejects an unsigned, mis-signed or stale request
- [ ] E-way expiry warns inside the window and expires past it
- [ ] `lr.released` sends only where sharing was requested — sharing is never required to advance the trip (`BR-22`)
- [ ] Every notification row carries its template, provider reference and final status
- [ ] No promotional template exists
