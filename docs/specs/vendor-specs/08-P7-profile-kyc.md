# 08 · Profile & KYC — wave `P7`

**Depends on:** 02 · console `C2` (vendor file, compliance queue)
**Delivers:** the transporter's own file, and the re-upload path when compliance rejects a document.
**Owns:** `BR-23`

---

## 1 · Screen — `/portal/profile`

`GET /portal/profile` · `portal.self`
`POST /portal/profile/documents/:kind` · `portal.self` · `BR-23`

Profile sits in the header account menu, not the bottom tabs — four tabs is the ceiling on a phone (part 03).

**Read-only:** company details.

**KYC and legal documents** — each with status and, where rejected, **the reason and a re-upload action**.

**Also shown:** advance policy % (`BR-30`), bank account (masked), and their business with us — trips, value, outstanding.

### The rejection reason is the whole point of this screen

A document rejected without a reason is re-uploaded identically. Compliance rejects it again. Nobody has moved. State it:

> **Address proof — rejected 3 Aug.** *Electricity bill is more than three months old.* Upload a recent one.

---

## 2 · Card capture — `BR-23`, `D-27`

PAN card photo, Aadhaar card photo, and the geo-stamped selfie are captured here.

These are the **only two capture screens** that would use a native camera — and since the shell is deferred (part 09), both ship as:

- **File inputs with `capture="environment"`**, which opens the phone camera in a mobile browser
- **Geolocation API** for the selfie's geo-stamp, coordinates written onto the attachment record

If `P8` is ever approved, `window.NexraahNative` upgrades these two screens and nothing else (part 09 §2). The web path is not a fallback to be removed later; it is the shipping path.

### What is stored and what is not

| Item | Retention |
|---|---|
| Aadhaar **number** | **Last four digits only** (`BR-04`, `NFR-04`). Never the full number |
| PAN card image · Aadhaar card image · selfie | **Life of the relationship** (`BR-46`, `D-27`), then deleted by a scheduled job (`R-04`) |
| Verification route and verifier | Recorded per check (`BR-31`) |

Identity verification happens **once per transporter, not per load** (`D-08`, `BR-31`). The screen should say so — a transporter asked for the same documents on every trip assumes the platform lost them.

`R-04` is live here: retaining Aadhaar images for the life of the relationship is a data-protection obligation that grows with the panel. Images are encrypted at rest, access restricted to compliance, signed URLs at 15-minute expiry.

---

## 3 · Vehicle documents feed `DOCS_DUE`

RC, insurance, fitness and PUC uploaded here are four of the eight in `BR-58` — the set that gates the advance (console part 07). When one lapses, the vehicle flips to `DOCS_DUE` and cannot be offered on a quote (part 04 §2).

Close the loop on this screen: a lapsed document shows which **truck** it grounds, so the transporter sees the cost of not fixing it.

> **Fitness certificate — expired 2 Aug.** AP16 TA 4471 is unavailable for new loads until this is renewed.

---

## 4 · Endpoints

| Method | Path | Permission | Rules |
|---|---|---|---|
| GET | `/portal/profile` | `portal.self` | Vendor-scoped |
| POST | `/portal/profile/documents/:kind` | `portal.self` | `BR-23` |

---

## 5 · Tests

- [ ] `GET /portal/profile` returns only this vendor; bank account is masked
- [ ] Aadhaar number in the response is four characters at most (`BR-04`)
- [ ] Full Aadhaar number appears nowhere in any payload or log
- [ ] PAN and Aadhaar card images are mandatory to complete the file (`BR-23`)
- [ ] A rejected document shows the compliance reason and offers re-upload
- [ ] Re-upload resets the document to `PENDING`, not to `VERIFIED`
- [ ] File input opens the camera on a mobile browser with no shell present
- [ ] Selfie without geolocation permission → clear error, not a silent success
- [ ] Uploading a renewed fitness certificate clears `DOCS_DUE` on the affected vehicle after verification
- [ ] Attachment signed URLs expire at 15 minutes
- [ ] Suspended vendor can read the profile but not upload

---

## 6 · Done when

- [ ] Every rejected document states its reason
- [ ] Capture works on a phone browser; no dead button when `NexraahNative` is undefined
- [ ] Lapsed vehicle documents name the truck they ground
- [ ] Every test above passes
