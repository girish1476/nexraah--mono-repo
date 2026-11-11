# 10 · Notifications — `P2` onward

**Depends on:** 01
**Delivers:** the nine transactional messages that make the portal usable by someone who does not open it daily.

All through the **DLT-registered gateway** (`D-31`). Templates registered against the DLT entity.

---

## 1 · The dependency is already met — `D-31`

DLT registration and TRAI approval are **complete** and a gateway is integrated. Without DLT registration no gateway integration is possible at all in India, so this is a solved dependency rather than an open one (FSD B7, priority *Ready*).

What remains is build work, not procurement:

1. Register the nine templates below against the DLT entity
2. Map each event to its trigger
3. Wire dispatch to the console's `notification-dispatch` job (console part 11)

---

## 2 · The nine templates

| Event | Trigger | Channel | Part |
|---|---|---|---|
| `vendor.activated` | Compliance clears the file (`BR-01`) | SMS | 01 |
| `load.published` | New indent matching their states and fleet | SMS | 03 |
| `quote.awarded` | Their quote wins | SMS + push | 03 |
| `lr.released` | LR issued | WhatsApp with document | 05 |
| `pod.due` | Day 15 | SMS | 06 |
| `pod.breached` | Day 21, then weekly | SMS | 06 |
| `pod.rejected` | Verification fails | SMS + push | 06 |
| `pod.forfeit_warning` | Day 35 | SMS | 06 |
| `payment.released` | Advance or balance paid | SMS with UTR | 05 |

**No promotional messages.** Every template above is transactional under the DLT registration. A promotional send from a transactional entity risks the registration itself, which would take the gateway down for all nine.

---

## 3 · The POD four are the ones that earn their keep

Day 15, day 21, day 35 — three of the nine are the penalty clock reaching out to someone who is not looking at the portal.

The FSD's Leak 3 is *"nobody owns the chase, and there is no deadline against which a POD is formally late."* The chase list (console part 06) gives the branch a deadline; these three give the transporter one. A `pod.breached` SMS on day 21 naming the accruing amount is the cheapest intervention in the platform.

Each must carry the **number and the rule**, not just an alert:

```
Nexraah: POD for LR-88215 is 21 days overdue.
Rs 100/day now applies (Rs 100 so far). No balance is paid past 40 days.
Courier it to your branch — the clock stops when we receive the paper.
```

That last sentence is `D-35` in an SMS. It is the same sentence part 06 puts on the screen, for the transporter who never opened the screen.

`payment.released` carries the **UTR** because `BR-09` records it and a transporter reconciling their bank statement needs it. It is the message that stops the "has it gone?" phone call.

---

## 4 · Push is `P8`-dependent

Two events list `SMS + push`. Push arrives with the Expo shell (part 09), which is **blocked**. Until then those two send SMS only — and since SMS is the primary channel for both, nothing is lost. Do not build a web-push path as a substitute; a transporter who never installs a PWA will never grant the permission.

---

## 5 · Tests

- [ ] Every template is registered against the DLT entity before its first send
- [ ] `vendor.activated` fires on console activation, not on vendor draft creation
- [ ] `load.published` matches on operating states **and** fleet types — a transporter with no matching truck is not messaged
- [ ] `pod.due` fires on day 15, `pod.breached` on day 21 then weekly, `pod.forfeit_warning` on day 35
- [ ] `pod.breached` content includes the accrued rupee figure and the branch-receipt sentence
- [ ] `payment.released` includes the UTR
- [ ] No send goes to a `BLACKLISTED` vendor
- [ ] Dispatch is idempotent — a job retry does not double-send

---

## 6 · Done when

- [ ] Nine templates registered and mapped
- [ ] Dispatch wired to the console job with retry and a provider reference recorded
- [ ] The three POD messages carry the amount and the rule
- [ ] Every test above passes
