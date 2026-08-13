# 04 · Fleet — wave `P3`

**Depends on:** 02 · console `C2` (`vendor_fleet` belongs to an onboarded vendor)
**Delivers:** the inventory the transporter maintains themselves, and the `DOCS_DUE` state that stops a paper-less truck being offered on a load.

This is the smallest wave and the highest leverage on the console side: `GET /portal/loads` filters on fleet types, and a stale fleet is the commonest reason a transporter sees an empty list (part 03 §1).

---

## 1 · Screen — `/portal/fleet`

`GET | POST | PATCH /portal/fleet` · `portal.self`

| Field | Type | Req | Validation |
|---|---|---|---|
| Registration | text | ● | Indian format, unique **within vendor** |
| Vehicle type | select | ● | Master |
| Capacity (tonnes) | number | ● | > 0 |
| Current city | text | ○ | |
| Status | select | ● | Available · On trip · **Docs due** · Maintenance |
| Free from | date | ◐ | Required when `ON_TRIP` |

Registration is unique **within vendor**, not globally — the same truck can legitimately appear on two panels when a vehicle is attached rather than owned (FSD glossary, Owner vs Vendor). A global unique constraint would also let one transporter probe whether another has a given truck, which is `NFR-02` leaking through an error message.

---

## 2 · `DOCS_DUE` — set by the system, not the transporter

Adopted from the design review. It surfaces a truck whose papers have lapsed — **neither available nor on a trip**.

| Property | Behaviour |
|---|---|
| Set by | The system, when **RC, insurance, fitness or PUC** expires |
| Cleared by | Re-upload and verification of the lapsed document (part 08) |
| Effect | **Blocks that truck from being offered on a quote** (part 03 §2) |
| Transporter can set it | No. The other three statuses are theirs; this one is not |

### Why these four documents

They are four of the eight in `BR-58`, the set that gates the advance (console part 07). A truck whose fitness certificate lapsed cannot pass the advance gate, so offering it on a quote wastes the desk's award and the transporter's day. Blocking at quote time is the same rule enforced a week earlier, where it costs nobody anything.

The screen must say which document and when:

> **Docs due** — Fitness certificate expired 2 Aug. Re-upload it in Profile to make this truck available again.

A bare `DOCS_DUE` pill with no reason generates a support call, and the transporter is the only person who can fix it.

---

## 3 · Endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/portal/fleet` | `portal.self` | Vendor's own only |
| POST | `/portal/fleet` | `portal.self` | Create |
| PATCH | `/portal/fleet/:id` | `portal.self` | `DOCS_DUE` not settable by the caller |

---

## 4 · Tests

- [ ] `GET /portal/fleet` returns only this vendor's vehicles
- [ ] Duplicate registration within the vendor → `409`; the same registration under another vendor → `201`
- [ ] `PATCH` attempting to set `DOCS_DUE` → `422`
- [ ] `PATCH` attempting to clear a system-set `DOCS_DUE` → `422`
- [ ] `ON_TRIP` without `free_from` → `422`
- [ ] A vehicle in `DOCS_DUE` does not appear in the truck selector on the quote form
- [ ] A vehicle in `DOCS_DUE` submitted directly to `POST /portal/loads/:code/quote` → `422`, not silently accepted
- [ ] Expiring a document in the console flips the vehicle to `DOCS_DUE` without a portal action

---

## 5 · Done when

- [ ] Fleet list and edit work on a 360px viewport
- [ ] `DOCS_DUE` shows the document and its expiry date, and links to Profile
- [ ] The quote form filters on `AVAILABLE` and the server enforces it (`NFR-01`)
- [ ] Every test above passes
