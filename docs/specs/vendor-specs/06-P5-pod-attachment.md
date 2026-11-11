# 06 · POD attachment — wave `P5`

**Depends on:** 05 · console `C5` (the receiving register)
**Delivers:** the transporter's step in the five-state chain, and the clock explained before it costs them anything.
**Owns:** `BR-51`

> **Do not build this ahead of `C5`.** Attachment alone stops no clock (`D-35`). Without the branch receiving register, this screen shows a countdown that nothing in the system can halt, and the first ₹100 deduction lands with no explanation the transporter can act on.

---

## 1 · Screen — `/portal/trips/[id]/pod`

`POST /portal/trips/:id/pod` · `pod.upload` · `BR-51`, `D-33`

**No scanner, no edge detection.** A file input.

| Field | Type | Req | Validation |
|---|---|---|---|
| Files | file[] | ● | ≥ 1, image or PDF, ≤ 10 MB each. **Every page** |
| Courier docket number | text | ● | Mono. *"The branch uses this to match the physical copy when it arrives."* |
| Sent on | date | ● | ≤ today |
| Anything noted on the POD | textarea | ○ | Shortage, damage, detention hours |

### Why docket and sent-on are mandatory — `D-33`

Dropping the scanner took native capture from three screens to two (part 09). What replaces it is not a better camera but **two fields that let the branch match paper to file**.

An attached photograph and a signed physical copy are different things separated by roughly a week of courier time, and that week is where PODs are lost. The docket number is how a branch clerk holding an envelope on 12 August finds the file attached on 4 August. Without it the register is a pile of unmatched scans.

The free-text note matters more than it looks: shortage, damage and detention hours written here are what the branch captures as charges at verification (`BR-56`, `D-25`), and charge capture is what makes the P&L true (`R-01`).

---

## 2 · The chain, shown at the top

**Attach (you) → Received (branch) → Verified (branch) → Approved (branch)**

Four steps here, **five states in the system** (`BR-48`, `D-32`) — the fifth is `PENDING`, before anything is attached, which is the state this screen exists to move them out of. The transporter never sees the word; they see the clock.

Each of the three branch steps has a different owner internally (`D-34`), but to the transporter they are one queue with one meaning: *nobody has paid you yet*. Show them as steps, not as owners.

---

## 3 · The clock, stated plainly

```
14 days left in the window
Delivered 22 Jul. After 20 days a deduction of ₹100 a day applies,
and past 40 days no balance is paid.
```

Past 20 days this turns red: *"₹400 deducted so far — 4 days over."*

| Position | Display | Rule |
|---|---|---|
| 0–20 days | `{n} days left in the window`, mint | `BR-12` |
| 21–40 days | `₹{n} deducted so far — {n} days over`, red | `BR-24` |
| Past 40 | `Forfeited — no balance is payable on this trip`, red, terminal | `BR-25` |

> **Attaching does not stop the clock.** The clock stops when the branch logs the physical copy (`BR-49`, `D-35`). The screen must say so:
>
> *"The clock stops when we receive the paper copy, not when you attach it."*

Hiding that would make the first deduction feel arbitrary. The transporter carries the risk of a slow courier — that is the deliberate design (`D-35`), and a design that shifts risk must state where the risk sits. A transporter who reads this sentence on day 2 chooses a faster courier; one who discovers it on day 24 raises a dispute.

`R-02` is the counterweight to remember while writing this copy: forfeiting a balance at 40 days is commercially severe and may damage supply on thin lanes. The tone is a warning to act on, not a threat.

---

## 4 · Rejected POD — `BR-52`

Banner with the branch's reason, **the clock still running**, and a re-attach action.

Rejection returns the POD to `ATTACHED` — or to `PENDING` where no replacement is coming — and **does not stop the clock**. The banner must say both things:

> **Rejected — consignee stamp missing.** Send a replacement copy. The penalty clock has not stopped; it has been running since delivery on 22 July.

`pod_received_at` is cleared by the console on rejection. A transporter who believes rejection pauses the deadline will take a week to re-send.

---

## 5 · Endpoints

| Method | Path | Permission | Rules |
|---|---|---|---|
| POST | `/portal/trips/:id/pod` | `pod.upload` | `BR-51` |

Files land in `attachments` with `sha256` (console part 02), so a re-uploaded identical image is recognisable rather than duplicated.

Rate limit: file upload 60/hour (part 01 §4).

---

## 6 · Tests

- [ ] Attach without courier docket → `422` (`BR-51`)
- [ ] Attach without sent-on → `422`
- [ ] `sent_on` in the future → `422`
- [ ] Zero files → `422`; a file over 10 MB → `422`
- [ ] Successful attach sets POD state to `ATTACHED` and **does not** set `pod_received_at` (`BR-49`)
- [ ] Successful attach does **not** stop the penalty accrual — the console `pod-ageing` job still increments
- [ ] Attaching to another vendor's trip → **404**
- [ ] Rejected POD shows the branch reason and a running clock (`BR-52`)
- [ ] Day 21 display shows `₹100`; day 24 shows `₹400`
- [ ] Past day 40 the screen reads forfeited and the attach control is gone (`BR-25`)
- [ ] Suspended vendor cannot attach (`403 VENDOR_SUSPENDED`)

---

## 7 · Done when

- [ ] File input works in a mobile browser with no shell (`P8` is not a dependency)
- [ ] The clock sentence about branch receipt is on the screen, not in a tooltip
- [ ] Rejection banner states that the clock is still running
- [ ] Every test above passes
