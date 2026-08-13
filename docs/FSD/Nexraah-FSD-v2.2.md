# Nexraah — Functional Specification Document

**Version 2.2** — Design review incorporated · nine source corrections applied
**Date** August 2026 (v2.1) · corrections 10 August 2026 (v2.2)
**Audience** Leadership and investors, then the build team
**Status** Specification locked · working prototype complete · backend not started
**Classification** Confidential

A freight operations platform for an asset-light road transport business — covering how loads are booked, how trucks are found, how documents are verified, and how money moves in both directions.

> **This file is the canonical reference.** Every `BR-`, `NFR-`, `D-`, `R-`, `ACT-` and `MOD-` identifier used by Spec 1 (vendor portal) and Spec 2 (internal console) resolves here.
>
> It began as a faithful transcription of `Nexraah-FSD-v2.1.pdf` (41 pages). Version 2.2 applies nine corrections to defects found in that source — every one is listed in *Corrections applied in v2.2* below, with the original wording quoted, so nothing is changed silently. The PDF remains the historical record; this file supersedes it for build purposes.

---

## 00 · Corrections applied in v2.2

Nine defects in the v2.1 PDF are corrected here. Audit trail of the change is in `docs/specs/VERIFICATION-FSD-vs-SPEC-2.md` §3.

| Ref | Defect in v2.1 PDF | Correction in v2.2 |
|---|---|---|
| `F-01` | B9 stated *"Thirty-one decisions… No open points remain"*, and its tables listed only `D-01`–`D-31`. `D-32`–`D-38` — the seven decisions defining the entire POD chain — appeared only in the revision history. Document control simultaneously claimed *"Thirty-eight decisions are recorded in section B9"*. | `D-32`–`D-38` added to B9 as a third decision table. Counts corrected throughout to **thirty-nine** (`D-39` is new — see `F-02`). |
| `F-02` | Document control named an open question — *"whether a quote above the bid maximum should be refused outright or submitted for leadership approval"* — which Spec 1 cites as `Q-16`. No such entry existed in B9, which asserted no open points. `BR-05` refused any out-of-band quote, contradicting `BR-40`. | Resolved as **`D-39`**: below-band quotes are refused at entry; above-band quotes are accepted and flagged, and awarding one requires leadership approval. `BR-05` rewritten. This aligns `BR-05` with `BR-40`, `D-16` and B2 approval authority, which already routed above-band prices to leadership. |
| `F-03` | B3.6 "POD pending" said *"Uploading the POD marks it received and releases that trip's balance payment."* This contradicted `D-32`, `D-35`, `BR-49` (clock stops at branch receipt, not upload) and `BR-10` (balance releases on approval). | Sentence removed and replaced with the correct chain behaviour. Surviving v2.0 text. |
| `F-04` | B1 in-scope said *"client invoicing **with GST**"*; A6 said the invoice builder has *"automatic GST treatment"*; B3.12 listed *"GST percentage"* as an invoice-builder field. All three contradicted `D-06`, `D-26` and `BR-15`. | All three corrected to reverse charge. Surviving pre-`D-06` text. |
| `F-05` | Module count stated three different ways: A6 *"Eleven modules"* (then listed 14 plus Control), A8 *"All twelve modules"*, A9 *"grew from six modules to twelve"*. B3 specifies fourteen. | Corrected to **fourteen** throughout. Internal scope (Spec 2) is thirteen — fourteen less `MOD-PRT`. |
| `F-06` | B2 permission matrix had no `ADMIN` column despite `ACT-ADM` being an actor, its Control panel row read `—` for every role (nobody could configure the system), and it had no rows for POD, RFQ, Clients, Leads/market gap or Telematics. | Matrix reissued with an `ADMIN` column and the five missing module rows. |
| `F-07` | B4 listed `BR-47`, `BR-18`, `BR-19` and `BR-20` after `BR-56` rather than in sequence. | Catalogue reordered numerically. All rules present; none renumbered. |
| `F-08` | B9's first table described `D-07` as *"TDS deduction is mandatory"* with no superseded marker, though `D-24` supersedes it. `D-13` had the same problem against `D-30`. | Both marked **superseded** in the decision tables. |
| `F-09` | A9 §5 referenced open points `OP-04` and `OP-05`. No `OP-` register exists in the document. | Repointed to `R-01` and `R-03`, the build risks that actually carry those concerns. |

**New identifiers introduced in v2.2:** `D-39` (above-band quote handling), `BR-57` (advance-policy change approval), `BR-58` (mandatory advance document set, extracted from `BR-07`). `NFR-09` amended to fix the money unit.

---

## 00 · How to read this document

This document is in two parts because it has two jobs.

| Part | Written for | What it contains |
|---|---|---|
| **Part A** (pages 21–41 of the source layout) | Anyone, including readers with no logistics background | What the business does, what goes wrong in it, what the platform is, how a single load travels through it end to end, what has been built, what has been difficult, and what is still unresolved. No technical knowledge assumed. Every industry term is explained where it first appears. |
| **Part B** (pages 16–28 of the source layout) | Developers, testers, and anyone specifying or accepting the build | Scope boundaries, module-by-module specification, the numbered business rules the system enforces, the data it holds, document numbering, integrations required, non-functional requirements, and the open-points register. |

If you read only one thing, read **section A3** — the four places money leaks. Everything the platform does exists to close one of those four holes.

### A note on honesty

This document distinguishes carefully between three states, and marks each one where it applies:

- 🟢 **Built** — working today
- 🟠 **Simulated** — the screen works, the connection behind it does not
- 🔴 **Not started** — specified only

Section A9 gives the full picture. Nothing in this document claims a capability the platform does not have.

---

## 00 · Revision history

### Version 1.1 — seven corrections

LR and E-LR confirmed as one document with optional electronic sharing; freight confirmed as reverse charge; a trip number generated per order; PAN and Aadhaar card images required; a POD penalty introduced; spot rates set per indent with written evidence; transit days and remarks captured.

### Version 1.2 — the open points closed

All fifteen open points from version 1.0 have been answered by the business and are now written into the body of this document as rules rather than questions. The decisions are summarised below and recorded in full in section B9.

| Ref | Decision | Effect |
|---|---|---|
| `D-01` | Role-based permissions are mandatory | Reinstated as a core requirement, not an option. Nothing ships without it. |
| `D-02` | Buy price comes from the market | Monthly rates are published at RFQ for contract lanes. Spot loads are quoted after checking the sourcing rate at that moment. |
| `D-03` | Advance policy is set per transporter | Agreed at onboarding and held on the vendor file, rather than decided load by load. |
| `D-04` | Cost is freight; other charges are client-specific | Loading, unloading, detention and the rest are added only where the client's arrangement requires them. |
| `D-05` | P&L carries every cost to the company | Placement rate plus loading, unloading and all other costs, against the customer rate. The invented overhead allocation is withdrawn. |
| `D-06` | Reverse charge only | The forward-charge alternative is removed entirely from scope. |
| `D-07` | TDS deduction is mandatory | Managed through the transporter's declaration for now. *(Superseded by `D-24`.)* |
| `D-08` | Identity is verified once, not repeatedly | Where API costs are high, document photographs are uploaded and the compliance team verifies against them manually. Both routes are supported. |
| `D-09` | Three trip documents must be exact | Client invoice, e-way bill and lorry receipt. Errors in these are penalised on the road, so they are validated, not merely collected. |
| `D-10` | POD: 20 days, then ₹100 a day, then nothing | Penalty from day 21. Beyond **40 days** no payment is processed at all. This replaces the 30-day rule in version 1.1. |
| `D-11` | Our team raises every indent | Client requirements arrive by email or WhatsApp per that client's procedure. Client self-service is out of scope for this phase. |
| `D-12` | A branch serves 150 km | Client addresses map to the nearest branch within that radius, adjusted for demand, supply and geography. |
| `D-13` | Placement volume | Superseded by `D-30` — see version 2.0 below. |
| `D-14` | Spot rate approval is mandatory documentation | The client's confirmation — email or WhatsApp — must be attached at indent creation. |
| `D-15` | No system to replace; DLT is done | Nothing to migrate from. DLT registration is complete; a messaging gateway must be integrated. |

### Version 2.0 — locked

A second round of sixteen questions arising from those decisions has been answered. There are no open points. Four answers changed rules already written into version 1.2 and are called out below.

| Ref | Decision | Effect |
|---|---|---|
| `D-16` | Approval hierarchy is defined | Finance releases every payment. A price above the band needs leadership approval. Anyone senior to operations — compliance or a manager — may approve an operational exception. |
| `D-17` | Indenting is a function, not a fixed team | It may sit with a dedicated indent team, with compliance, or with operations. The system grants it as a permission rather than assuming an org chart. |
| `D-18` | Lanes are won through RFQ | A new process enters the specification: clients run RFQs on their own cycle — three, six or twelve months — operations supplies sourcing rates, and the quote is average rate plus overheads plus margin. Lowest bid wins the lane. |
| `D-19` | An unquoted band is a market gap, not a licence to widen | The band is not stretched to force a placement. The failure feeds lead generation, and for RFQ lanes the vendor base is built ahead of bidding. |
| `D-20` | A spot load must never be quoted at a loss | Operations supplies the sourcing rate and the quote is built from it. The system blocks a spot quote below cost. |
| `D-21` | Reporting date matters as much as transit days | Some clients require the vehicle on the same day. Failure to report on time is a transit delay in its own right, with a remark recorded against it. |
| `D-22` | Advance is standard, set by compliance | Compliance maintains the percentage on the vendor file. An urgent load may override it with approval. |
| `D-23` | Penalty waiver: compliance proposes, leadership approves | The ₹100 per day is not waived at the desk. |
| `D-24` | **TDS is not being deducted yet** | Changes `D-07`. The declaration is held on file and no deduction is made today. When placement volume grows, finance will deduct and remit through the portal — and only on the amount actually paid, not on the whole freight. |
| `D-25` | Other charges are marked up | Captured by the document verification function from what is written on the POD, marked up, and billed on. |
| `D-26` | Reverse charge is permanent for this entity | Forward charge would require a separate GST registration under a separate entity — a later phase, out of scope here. |
| `D-27` | Aadhaar image is held for the life of the relationship | Retained while the transporter works with us. |
| `D-28` | A document mismatch rejects the document | The team is asked to re-upload. An override requires a reason, and an internal error is corrected in the system rather than worked around. |
| `D-29` | Branch overlap follows the client's operating location | Leadership may override the mapping. |
| `D-30` | **Scale corrected: 150–200 vehicles a month** | Changes `D-13`. That is the realistic placement volume today, averaged over the year, rising 1.5× at peak. 500+ per branch is an ambition for the head office that would need capital in crores, and is not the sizing basis for this build. |
| `D-31` | Messaging is ready to connect | DLT registration and TRAI approval are complete and a gateway is integrated. Without DLT no gateway integration is possible at all, so this is a solved dependency rather than an open one. |

### Version 2.1 — the POD chain

A review of the transporter portal design surfaced four gaps and one conflation. The proof of delivery turns out to have a longer life than the specification described, and that has consequences for who holds it, when the penalty stops, and when the balance can be paid.

| Ref | Decision | Effect |
|---|---|---|
| `D-32` | **The POD has five states, not two** | Attached → Received at branch → Verified → Approved, with forfeiture outside the chain. Each transition has a different owner. Version 2.0 had only pending and received. |
| `D-33` | No scanner — plain attachment | The transporter attaches a photo or PDF. A **courier docket number** and a sent-on date become mandatory, because they are how the branch matches the paper arriving next week to the file attached today. |
| `D-34` | Verifying and approving are separate | Verifying is a clerical check. Approving is the decision to pay against it. The approver must be a different person from the verifier. |
| `D-35` | **The penalty clock stops at branch receipt** | Not at attachment. If a photograph stopped the clock the paper would never arrive. The transporter therefore carries the risk of a slow courier. |
| `D-36` | The lorry receipt is visible in the portal | The transporter carries the document and could not see it. Redacted — no consignor, consignee or client name, and never our sell rate. |
| `D-37` | A transporter's bill is not our invoice | Two documents were being conflated. The transporter bills us; we bill the client. Both under reverse charge, neither carrying GST. |
| `D-38` | Portal data is redacted at the source | Client name, sell rate and quote count are never sent to a transporter — absent from the payload, not hidden in the interface. |

### Version 2.2 — corrections

Nine defects in the v2.1 source are corrected (see *Corrections applied in v2.2* above). One of them required a business answer, which is recorded as a decision in its own right.

| Ref | Decision | Effect |
|---|---|---|
| `D-39` | **A quote above the bid maximum is accepted, not refused** | Resolves the open question carried in v2.1's document control (`Q-16` in Spec 1). A quote **below** the bid minimum is refused at entry — it would run at a loss for both sides. A quote **above** the bid maximum is accepted, stored and shown to the desk marked out-of-band; **awarding** it requires leadership approval under `BR-40`. Refusing above-band quotes outright would hide the true market rate on a lane, which is the signal `D-19` depends on to declare a market gap. Rewrites `BR-05`. |

---

## Contents

**Part A — The plain English view**

| § | Title |
|---|---|
| A1 | What Nexraah is |
| A2 | The business it serves |
| A3 | The problem — where money leaks |
| A4 | How Nexraah closes the leaks |
| A5 | One load, end to end |
| A6 | What the platform contains |
| A7 | Who uses it |
| A8 | Where it stands today |
| A9 | Difficulties |
| A10 | What happens next |

**Part B — The specification**

| § | Title |
|---|---|
| B1 | Scope |
| B2 | Actors |
| B3 | Module specifications |
| B4 | Business rules catalogue |
| B5 | Data dictionary |
| B6 | Numbering and documents |
| B7 | Integrations required |
| B8 | Non-functional requirements |
| B9 | Decisions and sign-off |
| B10 | Glossary |

---

# Part A — The plain English view

> Written for a reader who has never worked in logistics. It explains the trade, the money in it, what goes wrong, and how the platform is built to stop it.

## A1 · What Nexraah is

Nexraah is a single piece of software that runs a road freight business end to end. A client calls with goods to move; Nexraah records the requirement, finds a truck through a panel of transport companies, issues the legal paperwork, tracks the journey, collects the delivery proof, bills the client, pays the transporter, and reports what the business earned.

The important thing to understand up front is **what kind of freight business it is built for**. There are two models in road transport:

| Model | How it works | What software must solve |
|---|---|---|
| **Fleet owner** | You own the trucks and employ the drivers. Your cost is diesel, maintenance, salaries and finance on the vehicles. | Vehicle utilisation, maintenance schedules, fuel theft, driver management. |
| **Asset-light broker** *(Nexraah is this one)* | You own few or no trucks. You take the load from the client and place it on a transport company's truck. You earn the difference between what the client pays you and what you pay the transporter. | Finding capacity, controlling the buy price, verifying strangers' documents, and not paying out before you can bill. |

That distinction shapes everything. A fleet owner's software is about vehicles. Nexraah's is about **vendors** — the transport companies whose trucks you use — because they are simultaneously your supply, your biggest cost, and your biggest risk. You are paying money to companies you do not own, on the strength of documents they give you, for goods belonging to someone else.

> **In one sentence.** Nexraah is a control system for a freight brokerage: it makes sure a truck is found for every load, that the truck and its driver are legitimate, that the goods arrive with proof, that the client is billed, and that no money leaves the company before the paperwork justifying it exists.

## A2 · The business it serves

Before the problems make sense, six terms need explaining. They appear throughout this document and throughout the software.

| Term | What it means |
|---|---|
| **Indent** | A request for a truck. The client says "I need 28 tonnes of cement moved from Guntur to Chennai on the 4th." That requirement, recorded in the system, is an indent. It exists before any truck is found. |
| **Placement** | Finding a truck for an indent and getting it to the pickup point. "The load was placed" means a physical vehicle turned up. Failure to place is the single most damaging operational event in this business. |
| **Lorry Receipt (LR)** | The legal contract of carriage — traditionally a carbon-copy book in the truck's cab. It records who sent the goods, who receives them, what they are, and which vehicle carries them. No LR, no legal basis for the movement. Nexraah issues it digitally; "E-LR" is the same document produced by the system rather than written by hand, not a second document. Sharing it electronically with the transporter or consignee is **optional**. |
| **POD** | Proof of Delivery — the LR copy signed by the receiver confirming the goods arrived. It is the document that entitles you to be paid. Most clients will refuse an invoice without it. |
| **E-way bill** | A government-issued electronic permit required for moving goods above a value threshold. It has a hard expiry. If it lapses mid-journey, the truck can be detained and penalised at a state border checkpoint. |
| **Detention** | A charge levied when a truck is held at loading or unloading beyond the agreed free hours. It is billed to the client and usually owed onward to the transporter. |

### How the money works

The economics are simple and thin. On a load billed to the client at ₹41,500, the transporter might be paid ₹36,000. The ₹5,500 difference is gross margin, before branch costs. Margins in this trade typically run **11% to 19%**, which means two things:

- A single failed placement, or one invoice a client refuses over a missing POD, can wipe out the margin on several successful loads.
- The buy price has to be controlled deliberately. If the desk pays whatever a transporter asks because the truck is needed today, the margin disappears quietly and nobody notices until the month closes.

### How lanes are won: the RFQ

Contract business is not simply agreed — it is bid for. A client runs a **request for quotation** on its own cycle, commonly three, six or twelve months. For each lane in it, operations supplies the **sourcing rate** — what it costs to buy that truck in the market — either month by month across the period or as a high and a low. The quote to the client is then built deliberately:

```
average sourcing rate + overheads + margin = the rate quoted
```

The client awards each lane to the lowest bid. Winning therefore depends on having a transporter base deep enough on that lane to source competitively — which is why building the vendor panel ahead of an RFQ is a commercial activity, not an administrative one. A lane won without the capacity to serve it becomes a placement failure every week.

**Spot business** works differently: the client asks for one truck now, operations checks the sourcing rate at that moment, and a price is quoted on it. The rule there is absolute — **a spot load is never quoted at a loss**.

### What the cost of a load actually is

The cost of a load is the **placement rate** — what the transporter is paid to carry it. Where the client's arrangement requires them, **loading, unloading, detention and other charges** are added on top; they are not assumed on every load. Profitability is measured as the customer rate less every cost the company incurs on that consignment, which is why those charges are captured against the load rather than absorbed into a branch overhead figure.

### Tax: the client pays the GST, not us

Freight here moves under the **reverse charge mechanism**. The transport operator does not charge GST on the invoice; the recipient of the service — the client — accounts for and pays the tax directly to the government. Practically this means the invoice carries the freight value and the statement that tax is payable by the recipient under reverse charge, and no CGST, SGST or IGST line is added to it. It keeps billing simpler, and it means the margin figures in this document are freight-in less freight-out with no tax component in between.

### The timing problem

Cash goes out before it comes in, and the gap is wide:

| Day | Event |
|---|---|
| **Day 0** | Truck placed. Advance paid to transporter — often 30–50% of the freight. |
| **Day 2** | Goods delivered. |
| **Day 2–20** | POD travels back from the destination, physically. |
| **Day 20** | Balance paid to transporter against POD. |
| **Day 22** | Client invoiced. |
| **Day 52+** | Client pays on 30–60 day credit terms. |

The business funds roughly fifty days of working capital on every load. That is why POD collection is treated in this platform as a first-class function with its own page, its own deadline and its own escalation — not as filing.

## A3 · The problem — where money leaks

Everything the platform does exists to close one of four holes. This is the core of the document.

### Leak 1 · You cannot find a truck

A load is accepted from the client and no vehicle turns up by the pickup date. The client is let down, the revenue is lost, and if it happens on the same lane repeatedly the client moves their business to someone with better capacity.

**Why it happens:** the transporter panel is too thin on that lane; the rate offered was below market and nobody quoted; a transporter accepted the load and then diverted the truck to a better-paying shipper. Without a system, none of these causes is distinguishable after the fact — the desk just remembers "it didn't go".

### Leak 2 · You pay a transporter you should not have

Money is released to a transport company whose papers are not in order — no valid registration for the vehicle, no goods insurance, an expired fitness certificate, a driver without a valid licence. If the consignment is then damaged, stolen or impounded, there is no insurer to claim against and no legal recourse against a company that may barely exist.

**Why it happens:** the advance is paid in the rush of getting the truck loaded, and the document check is done later, or never.

### Leak 3 · The POD never comes back

Goods are delivered but the signed proof stays in a driver's cab, a transporter's office, or a consignee's reception desk. Without it the client will not accept the invoice. The revenue sits unbilled and ages quietly until someone notices — often at quarter end, by which time the people who could find the document have moved on.

**Why it happens:** nobody owns the chase, and there is no deadline against which a POD is formally late.

### Leak 4 · You do not know which business is profitable

Revenue is visible; cost per load is not aggregated. The business grows turnover on lanes and clients that lose money, funded by the ones that make it. Nobody can see this without joining what the client was billed to what the transporter was paid, per load, per lane, per branch.

**Why it happens:** billing lives in accounting software, payouts live in a ledger or a WhatsApp thread, and neither knows about the other.

> Each of the four is a discipline problem, not a technology problem. Software cannot force anyone to be disciplined — but it can make the undisciplined path impossible, which is what this platform does.

## A4 · How Nexraah closes the leaks

The platform's answer to each leak is a control that cannot be skipped, because the next step in the workflow is simply not available until the previous one is done.

| Leak | The control | Where it lives |
|---|---|---|
| **1 · No truck found** | Every indent carries a **bid band** — a floor and ceiling the desk may transact within. Transporters quote through their own portal. Failures are captured with a cause, and repeated failures on a lane surface as a **market gap** for that branch to fix by recruiting. | Indents · Vendor portal · Today · Market gap |
| **2 · Paying the wrong transporter** | A transporter cannot be assigned to a load until compliance clears their file. The **advance will not release** until the load's documents are uploaded and individually verified. Every payment records a bank UTR reference. | Vendor onboarding · Compliance desk · Indent page |
| **3 · POD never returns** | PODs have a **20-day turnaround** from delivery, and pass through four hands — the transporter attaches it, the branch receives the physical copy, verifies it, then approves it (`D-32`). The clock stops at **branch receipt**, not attachment (`D-35`). Beyond 20 days a **penalty of ₹100 per day** accrues on actuals. Beyond **40 days no payment is processed at all**. The **balance will not release** until the POD is approved. | POD pending · Trip page |
| **4 · Unknown profitability** | Buy price and sell price are recorded against the same consignment, so margin is known per load and rolls up by client, lane, branch, day, month and quarter. | P&L · Home · Today |

> **The two money gates.** If you remember nothing else about how the platform works, remember these. **The advance is gated on document verification. The balance is gated on the POD.** Both gates are enforced in the interface — the payment panel states plainly what is missing and the button cannot be pressed. Together they mean the company never has money outside the door without the paperwork that justifies it.

## A5 · One load, end to end

This section follows a single consignment through every screen. It is the fastest way to understand the whole platform.

| # | Step |
|---|---|
| 1 | Indent raised |
| 2 | Transporters quote |
| 3 | Quote awarded |
| 4 | Truck placed |
| 5 | Docs verified · advance paid |
| 6 | Trip & LR issued |
| 7 | In transit |
| 8 | Delivered |
| 9 | POD collected |
| 10 | Balance paid |
| 11 | Client invoiced |
| 12 | Payment received |

**1 · The client asks for a truck.** Amaravati Cements needs 28 tonnes moved from Guntur to Chennai on 4 August in a 32-foot trailer. The operations desk raises an **indent**. Because the client is on a contract with an agreed rate card, the freight of ₹41,500 fills in automatically from the lane and truck type. The desk sets a **bid band** of ₹38,000–45,000, an **advance of 30%**, and the **transit days** the client has asked for — three days door to door — with any special instruction recorded in **remarks**. The indent is now open and visible to the transporter panel.

**2 · Transporters quote.** Transport companies see open loads in their own **vendor portal** — not the internal system — and quote against them, offering a specific truck from their own fleet list. Quotes outside the band are rejected automatically. Two companies quote: ₹40,800 and ₹41,200.

**3 · The desk awards it.** The indent page shows quotes cheapest first, each marked as inside or outside the band. Awarding one assigns that transporter and writes their rate onto the indent, so the buy price is captured at the moment of the decision rather than reconstructed later.

**4–5 · Truck placed, documents verified, advance released.** The transporter reports a vehicle. Now the first gate: the desk collects the **vehicle documents** (registration, goods insurance, fitness, permit, pollution certificate), the **driver's licence**, and the **client documents** (the sales invoice or purchase order, and the e-way bill). Each is uploaded and individually marked verified.

Only when documents are verified does the advance panel unlock. It shows ₹12,450 — thirty per cent of ₹41,500 — as a fixed, non-editable amount, alongside the transporter's bank details taken from their onboarding file. The payment is made by internet banking and the **UTR reference and value date** are recorded against the indent.

**6–8 · Trip opened, LR issued, transit, delivery.** Issuing the receipt opens a **trip** — the operational record of this order, with its own trip number carried alongside the indent number and the LR number. The **LR** is issued — consignor, consignee, goods, vehicle, driver, invoice and e-way bill details, with charges — and prints as a professional document with a scannable barcode. It can optionally be shared with the transporter by WhatsApp or email; the printed copy remains the primary form. The vehicle then appears on the **telematics** board, which tracks position, speed, fuel, and the e-way bill's remaining validity, raising alerts for overspeed, long halts, lost GPS signal and expiring permits.

**9–10 · POD and the balance.** On delivery the 20-day POD clock starts. Until the signed document is uploaded, the trip's balance payment panel reads **Blocked** and states why. Once it is in — along with the remaining verified documents — the balance releases: freight less the advance already paid, again with a UTR recorded.

**11–12 · Billing and collection.** The delivered consignment is now billable. An invoice is raised, either individually or as a billing run across several completed trips for the same client. Because freight moves under **reverse charge**, no tax is added — the invoice carries the freight and any detention or other charges, and states that GST is payable by the recipient. The invoice prints in **four copies**: shipper, consignee, POD and POD duplicate.

When the client pays, the receipt is recorded against the invoice with its UTR, the invoice closes or moves to part-paid, and the ageing updates. Every rupee of margin on this load is now known, and appears in the branch P&L for the month.

> **What that walkthrough demonstrates.** Twelve steps, four departments, three external parties, two payments and six legal documents — with a single record carrying the load from the client's phone call to the money landing in the bank. At no point does anyone retype what someone else already entered, and at no point can a payment be made out of sequence.

## A6 · What the platform contains

Fourteen modules, grouped into four areas that match how the company is organised, plus the control panel. Thirteen of the fourteen are internal — the vendor portal is the only one a transporter sees.

### Vendor management — the supply side

| Module | What it does |
|---|---|
| **Vendor onboarding** | A five-step file on every transport company: identity (PAN and Aadhaar verification, address proof, a geo-stamped photograph of our executive with them at their yard), legal documents (trade licence, labour licence, vehicle registration, MSME registration), a TDS declaration fixing the deduction rate, fleet details and base location, banking with a statement, and a named reviewer who signs the file off. |
| **Vendor portal** | What the transporter logs into: open loads to quote on, their own quote history, and a fleet inventory they maintain themselves — which trucks they have, where each one is, and whether it is free. |
| **Vendor search** | Any transporter's full picture: every trip they carried, total business done, what we still owe them, our margin on their work, the lanes they run and the trucks they have listed. |
| **Leads & market gap** | A recruitment pipeline for new transporters, a per-branch view of where capacity is short, and an issues register for complaints raised against transporters we already use. |

### Orders — the operational side

| Module | What it does |
|---|---|
| **Indents** | Raising load requests with bid bands and advance terms, collecting quotes, awarding them, and the document verification that releases the advance. |
| **Trips** | Every consignment, searchable by any identifier on it. Each trip opens as a page with two tabs — details and documents — carrying the truck, the driver, all documents with their verification state, POD upload, and the balance payment. |
| **Lorry receipt** | Part of the trip, not a separate record. Booking the consignment note, printing it with a barcode, optional electronic sharing, and release to the transporter. |
| **POD pending** | The chase list, aged against the 20-day deadline, showing the money each missing document holds up. Exportable. |
| **Compliance** | One queue for every verification in the business: transporter files, client contracts, and trip documents grouped as vehicle, driver and client documents. |
| **Telematics** | Live fleet positions with alerts for overspeed, long halts, lost signal and expiring e-way bills. |

### Accounts — the money side

| Module | What it does |
|---|---|
| **Clients** | Agreements with validity periods, spot or contract engagement, dated rate cards by lane and truck type, credit terms and service levels. |
| **Invoicing** | A customer master, an invoice builder carrying the reverse-charge declaration and no tax lines (`D-06`), the ledger, and four-copy printing. |
| **Receivables** | Recording payments received with reference and date, handling part payments, and ageing what is still owed. |
| **Profit & loss** | Branch-wise earnings against transporter cost, daily, monthly and quarterly, downloadable. |

### Control

An administrative panel where modules are switched on or off and the rules they run by are set — every document number series, whether an incomplete transporter file blocks assignment, how long a vehicle may go without a GPS ping before it is called dark, the overspeed threshold, how early to warn on e-way expiry, and the company details printed on every document. These are not decoration: changing the overspeed limit re-evaluates the live fleet alerts immediately.

## A7 · Who uses it

| Role | What they do in the system | Their screens |
|---|---|---|
| **Operations desk** | Raises indents, awards quotes, places trucks, issues lorry receipts, chases trucks in transit. | Today, Indents, Trips, Telematics |
| **Compliance** | Verifies transporter files and clears them for work; checks trip documents before payment; approves client contracts. | Compliance, Vendor onboarding |
| **Finance** | Releases advances and balances, raises invoices, records receipts, chases collections. | Indents, Trips, Invoicing, Receivables |
| **Branch manager** | Watches placement performance and margin for their branch; recruits transporters against the market gap. | Home, Today, P&L, Market gap |
| **Leadership** | Monthly business done, revenue mix, branch performance, POD and collection health. | Home, P&L |
| **Transporter** *(external)* | Sees open loads, quotes on them, keeps their fleet availability current. | Vendor portal |

### Who approves what · `D-16`

| Decision | Approver |
|---|---|
| Releasing any payment — advance or balance | **Finance.** No other role may release money. |
| A price above the agreed band | **Leadership.** |
| An operational exception — an urgent-load advance override, a document override | **Anyone senior to operations** — compliance or a manager. |
| Waiving a POD penalty | **Compliance proposes, leadership approves** (`D-23`). |
| Overriding a branch mapping | **Leadership** (`D-29`). |
| Changing a transporter's advance percentage | **Compliance**, with approval for any change to the standard (`D-22`). |

### A note on the indent team · `D-17`

Raising indents is treated as a **function, not a fixed department**. Depending on how the company is staffed at the time it may sit with a dedicated indent team, with compliance, or with operations. The system therefore grants indenting as a permission that can be attached to whichever role holds it, rather than hard-wiring an org chart that will change. The same applies to document verification, which currently sits with the indent function (`D-25`).

> **Role-based permissions are mandatory · `D-01`.** This is settled: every user sees and does only what their role allows. A transporter must never see another transporter's rates; the operations desk must not be able to release a payment; only compliance may clear a vendor file. The prototype currently has no roles — they were built, removed on instruction, and are now confirmed as a requirement. Section B2 carries the permission matrix.

## A8 · Where it stands today

A complete, working prototype exists. Every screen described in this document can be opened, every form can be filled, every rule fires. What does not exist is anything behind the browser.

| Area | State | Detail |
|---|---|---|
| All fourteen modules and their screens | 🟢 **Built** | Full interface, working forms, validation, and the business rules described in Part B. |
| Money gates (advance and balance) | 🟢 **Built** | Enforced end to end, including UTR capture. |
| Invoice printing | 🟠 **Needs change** | Four-copy A4 output and the barcode are built. The tax logic currently adds CGST/SGST or IGST and must be reworked for reverse charge — see section A9. |
| P&L, exports, analytics | 🟢 **Built** | Branch-wise daily, monthly and quarterly; CSV download. |
| PAN and Aadhaar verification | 🟠 **Simulated** | The flow works; no government API is connected. |
| E-way bill data | 🟠 **Simulated** | Numbers and validity are typed in; the NIC portal is not connected. |
| GPS positions and alerts | 🟠 **Simulated** | The board updates on a timer; no telematics provider is connected. |
| Payments | 🟠 **Simulated** | The system records that a payment was made and its UTR. It does not move money. |
| Notifications (WhatsApp, email, SMS) | 🟠 **Simulated** | Share buttons open the app with the message prefilled; nothing sends automatically. |
| Document upload and storage | 🔴 **Not started** | Upload buttons set a status flag. No file is stored anywhere. This includes the PAN and Aadhaar images, the spot rate confirmation, and the POD itself. |
| QR code on the lorry receipt | 🔴 **Not started** | The barcode is real and scannable. A QR needs a library. |
| Database and backend | 🔴 **Not started** | All data lives in browser memory and resets on reload. |
| Authentication and permissions | 🔴 **Not started** | The login screen is a gate, not security. Role-based permissions are confirmed mandatory (`D-01`) and must be built, enforced server-side. |
| Reverse charge on invoices | 🟠 **Needs change** | The prototype still calculates CGST/SGST and IGST. Under `D-06` that logic is removed and replaced with a reverse-charge declaration. |
| P&L cost basis | 🟠 **Needs change** | Currently a flat proportion of freight plus an invented overhead. Under `D-05` it must use the actual placement rate and every charge incurred. |

> **The honest summary.** What has been proven is the **design** — that these fourteen modules, these rules and this sequence hold together and match how the business actually runs. What remains is the **engineering**: a database, a server, real authentication, file storage, and six external integrations. That is a substantial build, and this document is the specification for it.

## A9 · Difficulties

### 1 · Where a control belongs is a business decision, not a design one

The hardest questions were not visual. Should the advance release on document upload, or on verification? Should a transporter with an incomplete file be blocked outright or merely flagged? Is a POD late at seven days or twenty? Each answer trades operational speed against financial risk, and each has to come from the business. Several were changed more than once during the build.

### 2 · Regulatory constraints shape the design

Aadhaar is the clearest case. A private company generally cannot store full Aadhaar numbers; the lawful route is OTP-based verification through a licensed agency, retaining only the last four digits. The platform is built that way and says so on screen — but this must be confirmed with your compliance advisers before go-live. GST treatment of freight, TDS rates under section 194C, and the e-way bill regime all impose similar structural requirements.

### 3 · Two different truths about the same load

The client is billed one number and the transporter is paid another. Most systems track one well and the other badly. Holding both against the same consignment is what makes margin visible — but it means the buy price must be captured at the moment of the award decision, which is exactly when the desk is busiest and least inclined to type.

### 4 · The scope moved, deliberately and often

The platform grew from six modules to fourteen during specification. Roles were built, removed, rebuilt and removed again. Navigation was restructured four times. This is normal and healthy at prototype stage — it is far cheaper to discover the shape here than after a backend exists — but it means **this document is a snapshot** and needs formal version control from here.

### 5 · Cost data is currently assumed

Transporter payout is modelled as a flat proportion of freight, and branch overhead in the P&L is an invented monthly allocation. Both were necessary to make the reporting work. Both must be replaced with real figures before any decision is taken on the strength of a P&L number. See `R-01` and `R-03`.

> **What we are actually sizing for · `D-30`.** Roughly **150 to 200 vehicles a month** across the business today, averaged across the year, rising about **1.5×** through the February to June peak. The earlier figure of 500+ per branch is an ambition for the head office rather than a present reality — reaching it needs capital in crores — and building infrastructure for it now would be paying for volume that does not exist. The architecture should not preclude it; the first release should not be priced for it.

## A10 · What happens next

| Phase | Outcome | What it involves |
|---|---|---|
| **0 · Decide** *(2–3 weeks)* | Open points closed | Answer the register in section B9 — particularly roles, the real cost model, and which integrations are in scope for version one. Nothing should be built before these are settled. |
| **1 · Foundation** *(6–10 weeks)* | It remembers things | Database, server, authentication, permissions, document storage. The interface already exists; this makes it real. Nothing new is visible to a user at the end of this phase, which makes the phase most likely to be under-resourced. |
| **2 · Core operations** *(6–8 weeks)* | The desk can run a day on it | Indents through to POD, with the money gates live. Run it in parallel with existing practice on one branch before extending. |
| **3 · Money** *(4–6 weeks)* | Billing and collection live | Invoicing, receivables, P&L against real cost data. Accounting-system reconciliation. |
| **4 · Connections** *(6–10 weeks)* | It stops relying on typing | E-way bill, GPS provider, KYC agency, WhatsApp notifications, payment initiation. |
| **5 · Transporter portal** *(4 weeks)* | Supply manages itself | Real transporter accounts, live bidding, fleet self-service. Highest leverage of anything in this list and the most dependent on transporters adopting it. |

> **One recommendation.** Resist launching all fourteen modules at once. The two gates — advance on verification, balance on POD — deliver most of the financial protection on their own, and they only need indents, trips, compliance and POD. Prove those on one branch, then extend. A platform that is trusted on four screens beats one that is ignored on fourteen.

---

# Part B — The specification

> Written for the team that will build, test and accept the system. Requirements are numbered so they can be referenced in tickets, test cases and sign-off.

## B1 · Scope

### In scope

| Area | Included |
|---|---|
| **Vendor lifecycle** | Lead capture, onboarding with KYC and legal documents, compliance clearance, performance and business history, issue register, self-service portal with bidding and fleet inventory. |
| **Order lifecycle** | Indent raising with bid bands and advance terms, quote collection and award, truck placement, document verification, E-LR issue, in-transit tracking, POD collection. |
| **Money** | Advance and balance payments to transporters with reference capture; client invoicing under reverse charge, carrying no tax lines (`D-06`, `BR-15`); receipts and ageing; branch profit and loss. |
| **Rate management** | Client RFQ cycles, sourcing rates supplied by operations, quote build-up (average rate plus overheads plus margin), awarded lanes becoming the rate card, and spot pricing from the sourcing rate of the day. |
| **Administration** | Module enablement, document numbering series, thresholds, approval routing, company details. |

### Out of scope for version one

- Owned-fleet management — maintenance schedules, fuel cards, driver payroll, tyre and battery life.
- Warehousing, inventory and multi-modal (rail, air, sea) movements.
- Route optimisation and load consolidation.
- A driver-facing mobile application. The transporter portal is web only in version one.
- **Client self-service.** Clients do not raise their own indents in this phase. Requirements arrive by email or WhatsApp per each client's own procedure and are keyed by our team (`D-11`).
- **Forward-charge GST.** Out of scope. This entity invoices under reverse charge for its lifetime; forward charge would require a separate GST registration under a separate entity and is a later-phase discussion (`D-26`).
- **TDS deduction.** Not performed in this release. The declaration is held on file and no deduction is made. When volume grows, finance will deduct and remit through the portal, on the amount actually paid rather than the whole freight (`D-24`).
- **Statutory accounting.** The system produces invoices and receipts; it is not the books of account and must reconcile to whatever accounting software the company keeps.

## B2 · Actors

| Code | Actor | Responsibility | Internal |
|---|---|---|---|
| `ACT-OPS` | Operations desk | Indents, awards, placement, E-LR, transit follow-up | Yes |
| `ACT-CMP` | Compliance | Vendor file clearance, trip document verification, contract approval | Yes |
| `ACT-FIN` | Finance | Advance and balance release, invoicing, receipts, collections | Yes |
| `ACT-BRM` | Branch manager | Placement performance, margin, transporter recruitment | Yes |
| `ACT-MGT` | Leadership | Reporting only | Yes |
| `ACT-VND` | Transporter | Quoting on loads, fleet availability | No |
| `ACT-ADM` | Administrator | Settings, numbering, approval routing, module enablement | Yes |

**Indenting and document verification are functions, not roles** (`D-17`). Either may be attached to a dedicated indent team, to compliance, or to operations, and the attachment may change without a code change. They are therefore specified as permissions — `PERM-INDENT` and `PERM-DOCVERIFY` — grantable to any internal role.

### Approval authority · `D-16`

| Action | Approver |
|---|---|
| Release of any payment | Finance only |
| Award or quote above the agreed band | Leadership |
| Operational exception — urgent-load advance override, document override | Any role senior to operations: compliance or manager |
| Waiver of a POD penalty | Compliance proposes, leadership approves |
| Logging a physical POD receipt | Branch — `pod.receive` |
| Verifying a POD | Branch or compliance — `pod.verify` |
| Approving a POD for payment | Branch manager or compliance — `pod.approve`, and not the verifier |
| Change to a transporter's advance percentage | Compliance, with approval for any departure from the standard |
| Override of a branch mapping | Leadership |

Role-based permissions are **mandatory** (`D-01`). The matrix below is the agreed baseline. Three levels apply: **None** hides the module entirely, **View** opens it read-only with no create, verify, approve or pay action, and **Edit** is full use. Every rule here must be enforced server-side on each request, not in the interface alone (`NFR-01`).

| Module | OPS | Compliance | Finance | Branch mgr | Leadership | Admin | Transporter |
|---|---|---|---|---|---|---|---|
| Vendor onboarding | View | **Edit** | View | View | View | View | — |
| Vendor portal | View | View | — | View | — | View | **Own only** |
| Vendor search | View | View | View | View | View | View | — |
| Leads · market gap · issues | **Edit** | View | — | **Edit** | View | View | — |
| Indents | **Edit** | View | View | **Edit** | View | View | — |
| Trips | **Edit** | View | View | View | View | View | — |
| Lorry receipt | **Edit** | View | View | View | View | View | **Own only** |
| Proof of delivery | View | **Edit** | View | **Edit** | View | View | **Attach only** |
| Advance / balance release | — | — | **Edit** | — | — | — | — |
| Transporter bills | — | View | **Edit** | View | — | View | **Own only** |
| Compliance desk | — | **Edit** | View | — | — | View | — |
| RFQ and rate management | **Edit** | View | View | **Edit** | **Edit** | View | — |
| Clients | View | **Edit** | **Edit** | View | View | View | — |
| Invoicing / receivables | — | — | **Edit** | View | View | View | — |
| Telematics | **Edit** | View | — | View | View | View | — |
| P&L | — | — | **Edit** | View own branch | View | View | — |
| Control panel | — | — | — | — | — | **Edit** | — |

Notes on the matrix, added in v2.2 (`F-06`):

- The `ADMIN` column and the Control panel grant were absent in v2.1, which left the system unconfigurable by anyone. `ACT-ADM` was already an actor in the table above.
- **Proof of delivery** is split by permission, not by module grant: `pod.receive` and `pod.verify` seed to `BRANCH_MGR` and `COMPLIANCE`; `pod.approve` seeds to `BRANCH_MGR` and `COMPLIANCE` and is additionally constrained by `BR-50` (approver ≠ verifier). Finance holds View so the chase list and the held balance are visible to the people releasing money.
- **RFQ**: operations and branch managers supply sourcing rates and build the quote; only leadership may submit it (`B3.9`).
- A **View** grant never carries a create, verify, approve or pay action, regardless of any permission attached separately.

## B3 · Module specifications

### B3.1 Vendor onboarding · `MOD-VND`

**Purpose:** establish that a transport company is real, solvent, insured and legally able to carry goods, before any load or money is entrusted to it. **Primary actor:** `ACT-CMP`.

| Step | Captured | Rules |
|---|---|---|
| **1 Company** | Transporter name, base city, party type (Owner / Vendor), GSTIN, phone, alternate number | Name, city, party type, phone mandatory. GSTIN optional — small transporters may be below the registration threshold. Alternate number optional. |
| **2 Identity verification** | PAN number with name match **and a photograph of the PAN card**; Aadhaar by OTP **and a photograph of the Aadhaar card**; address proof (rent agreement, electricity bill, loading advice, or office name-board photograph); geo-stamped selfie with the transporter; legal documents — trade licence, labour licence, RC, Udyam; TDS declaration with deduction basis | RC mandatory when party type is Owner. Otherwise at least one legal document. TDS declaration mandatory in all cases — it is held on file, though no TDS is deducted in this release (`D-24`). Both card images are mandatory and are retained for the life of the relationship (`D-27`). Only the last four digits of the Aadhaar **number** are retained. **Verification happens once, not on every load** (`D-08`): where an identity API is available it is used; where the per-check cost is not justified, the uploaded photographs are verified manually by the compliance team and the file is marked verified by a named person. Both routes must be supported and the route taken recorded. |
| **3 Fleet** | Trucks owned or attached (label follows party type), main body type, fleet base location, operating states | Count mandatory. |
| **4 Payment** | Bank account, IFSC, bank statement upload, **advance policy** — the percentage of freight this transporter is paid on placement, and the balance terms | Account mandatory. The advance policy agreed here becomes the default on every indent placed with this transporter (`D-03`). The percentage is a **standard** maintained by compliance; any departure from it requires approval, and an urgent load may override it with approval (`D-22`, `BR-57`). |
| **5 Review** | Both completion gauges, a summary of the file, what is still missing, verified-by and remarks | A named verifier is mandatory before submission. |

### B3.2 Vendor portal · `MOD-PRT`

**Purpose:** move supply management to the supplier. **Primary actor:** `ACT-VND`.

- **Available loads** — open indents with lane, material, weight, truck type, pickup, branch, the permitted bid band and the advance on offer. Quote form takes a rate, a truck chosen from the transporter's own available fleet, and remarks.
- **My quotes** — history with status: submitted, accepted, rejected.
- **Fleet inventory** — registration, type, capacity, current location, free-from date and a status the transporter maintains: available, on trip, docs due, in maintenance.
- **Trips** — for each consignment awarded to them: the **lorry receipt** with its barcode, downloadable (`D-36`); the **POD attachment** screen; and **raise your bill** once the POD is approved (`D-37`).

**Redaction is at the source** (`D-38`). A transporter is never sent the client name, our sell rate, another transporter's quote, or the number of quotes on a load. These fields are absent from the payload, not hidden in the interface — a field that never leaves the server cannot leak.

### B3.3 Indents · `MOD-IND`

**Purpose:** record demand, discover a price for it, and place a truck against it. **Primary actors:** `ACT-OPS`, `ACT-FIN`.

| Field | Notes |
|---|---|
| Client, pickup, delivery, material, weight, truck type, pickup date | All mandatory. |
| Freight offered (sell) | Auto-filled from the client's rate card on lane and truck type where one exists. |
| Placement rate (buy) | Set from the market (`D-02`). For a **contract** client the monthly rate published at RFQ for that lane is the reference. For a **spot** load the desk checks the sourcing rate at that moment and quotes accordingly. The awarded quote becomes the recorded buy price. |
| Advance % | Defaults from the assigned transporter's advance policy agreed at onboarding (`D-03`). The system shows the resulting split — amount on placement, balance against POD. |
| Bid rate minimum and maximum | The band transporters may quote within. Minimum must not exceed maximum. |
| Transit days | The transit time the client requires for this lane, taken from the RFQ or agreed at spot. Actual delivery is measured against it. |
| Vehicle reporting requirement | When the vehicle must report for loading. Some clients require it the **same day**, on which their unloading depends. Failure to report on time is a **transit delay** in its own right and is recorded as such, with a remark explaining it (`D-21`). |
| Remarks | Free text carried through to the trip and the lorry receipt — multi-point delivery, unloading arrangements, anything the desk needs to pass on. |
| Rate source | For a **contract** client the freight comes from the rate card. For a **spot** client the indent team enters the rate agreed for that load and **attaches the client's written confirmation** — the email or WhatsApp message evidencing it. The indent cannot be raised for a spot client without that attachment. |
| Branch | Derived from the pickup city. |

**Stages:** Open → Vendor assigned → Vehicle placed → Trip created. The indent page carries quotes with an award action, the document checklist, and the advance payment flow.

### B3.4 Trips · `MOD-TRP`

**Purpose:** the operational and financial record of a consignment in motion. A **trip number** is generated for every order at the point the consignment is opened, and is carried alongside the indent number and the lorry receipt number for the life of the record. It is the identifier operations quote internally; the LR number is the one that appears on the legal document.

- **Search** across indents and trips together, by any field or by a chosen one: LR number, indent ID, truck number, transporter, company, branch. Filters on stage, company, transporter, branch and POD status.
- **Trip page, Details tab** — route progress, consignment, branch, e-way bill, and a truck and driver panel with vehicle type, capacity, body, licence and load utilisation.
- **Trip page, Documents tab** — documents in five groups (client, vehicle, driver, lorry receipt, POD), each with upload and verify states, plus the balance payment panel.
- **Three documents must be exact** (`D-09`): the **client invoice**, the **e-way bill** and the **lorry receipt**. A discrepancy between them — a wrong value, a wrong vehicle number, a mismatched consignee — is penalised at a checkpost on the road. The system shall cross-check the common fields across the three and flag any mismatch **before the truck is dispatched**, not merely record that the documents exist. On a mismatch the document is **rejected** and the team asked to re-upload; proceeding regardless requires an **override with a recorded reason** by a role senior to operations. Where the error is ours, it is corrected in the system rather than worked around (`D-28`).

### B3.5 Lorry receipt · `MOD-LR`

**Purpose:** replace the carbon-copy lorry receipt book. The LR and the "E-LR" are the same document — one is simply issued by the system rather than written by hand — and are held as one record against the trip, not two. Captures general information, consignor and consignee (name, company, GSTIN, contact, mobile, address, city, state, PIN), shipment locations, goods (description, material, package type, quantity, actual and gross weight), invoice and e-way bill with validity, vehicle (number, type, capacity, truck type, trailer, container and size), driver, transit days, remarks, and six charge heads. Auto-saves as a draft. Prints A4 with a Code 39 barcode. **Electronic sharing by WhatsApp or email is optional** — used where the transporter or consignee asks for it; the printed copy remains the primary form. Statuses: Booked → Released → In transit → Delivered.

### B3.6 Proof of delivery · `MOD-POD`

**The POD lifecycle** (`D-32`). Five states, four owners:

| State | Owner | Meaning |
|---|---|---|
| **Pending** | — | Delivered; nothing submitted. |
| **Attached** | Transporter | Photo or PDF uploaded in the portal, with a courier docket number and sent-on date (`D-33`). **The penalty clock keeps running.** |
| **Received** | Branch · `pod.receive` | The physical copy has arrived and been logged against its docket. **The penalty clock stops here** (`D-35`). |
| **Verified** | Branch · `pod.verify` | Clerical check passed: consignee stamp, signature and date, LR number, quantity, and any shortage or damage noted. |
| **Approved** | Branch · `pod.approve` | The decision to pay against it. **Only this unblocks the balance.** The approver must differ from the verifier (`D-34`). |
| **Forfeited** | System | Past 40 days. Balance forfeited, trip closed. |

Rejecting at verification returns the document to the transporter for a replacement copy and **does not stop the penalty clock**. Charges written on the POD — loading, unloading, detention — are captured at verification, since that is the moment someone is reading the document (`D-25`).

#### POD receiving register

A branch-level register of physical proofs arriving by courier. Docket number, received date, pages in the envelope, who received it, and condition. It exists because an attached photograph and a signed physical copy are different things separated by roughly a week of courier time, and that week is where PODs are lost. A docket raised eight days ago with nothing arrived is visible here, and the branch chases the courier rather than the transporter.

#### POD pending — the chase list

**Purpose:** collect the document that entitles the company to be paid, within a deadline. Aged oldest-first from the delivery date against a 20-day turnaround. Shows the balance each missing POD is holding. Filters on branch, transporter and TAT position. CSV export.

> **Corrected in v2.2 (`F-03`).** This paragraph previously read *"Uploading the POD marks it received and releases that trip's balance payment"* — surviving v2.0 text that contradicts `D-32`, `D-35`, `BR-49` and `BR-10`. Attaching the POD in the portal **does not** mark it received and **does not** stop the clock; only logging the physical copy at the branch does (`BR-49`). The balance releases only on **approval**, and only finance releases it (`BR-10`, `BR-40`).

| Position | Treatment |
|---|---|
| **0–20 days** | Within turnaround. Balance held pending the POD; no penalty. |
| **21–40 days** | Breached. A penalty of **₹100 per day on actuals** accrues from day 21 and is deducted from the balance payable to the transporter. The accrued figure is shown on the chase list and on the trip, and reduces the payable amount as it grows. |
| **Beyond 40 days** | **No payment is processed.** The balance is forfeited and the trip closed with nothing payable to the transporter (`D-10`). The closure and its basis are recorded against the trip and reported to the transporter's file. |

**Waiver:** the penalty may be waived where the delay is not the transporter's fault. Compliance proposes and **leadership approves**; it is never waived at the desk. The proposal, the approval and the reason are recorded against the trip (`D-23`).

### B3.7 Compliance · `MOD-CMP`

**Purpose:** a single queue for every verification. Three segments — vendor files (identity and legal documents item by item, with a clear-and-activate action that only enables on a complete file), client contracts (approval, warning where no lanes are priced), and trip documents grouped as vehicle, driver and client documents.

### B3.8 Telematics · `MOD-TEL`

**Purpose:** know where the trucks are and what needs chasing. Live board with position along the route, speed, fuel, last ping and e-way bill validity. Alerts for overspeed, long halt, lost signal and expiring or expired e-way bills. All thresholds are set in the control panel and re-evaluate immediately.

### B3.9 RFQ and rate management · `MOD-RFQ`

**Purpose:** win lanes at a price that can be served profitably. **Primary actors:** `ACT-OPS` (sourcing rates), leadership (approval of the quote).

| Step | What happens |
|---|---|
| **1 RFQ received** | A client opens an RFQ on its own cycle — commonly 3, 6 or 12 months (`D-18`). Recorded with client, period, lanes, truck types and the submission deadline. |
| **2 Sourcing rates** | Operations supplies the market buy rate for each lane, either **month by month** across the RFQ period or as a **high and a low**. |
| **3 Quote build-up** | **Average sourcing rate + overheads + margin = quoted rate.** Each component is visible and stored, so a won lane can later be tested against what it actually cost. |
| **4 Submission and award** | Quote submitted; the client awards each lane to the lowest bid. Won lanes are recorded with their validity and **become the client's rate card** — no separate rate entry. |
| **5 Spot** | Outside any RFQ. Operations supplies the sourcing rate of the day and the quote is built from it. **A spot load shall never be quoted at a loss** (`D-20`). |

Where no transporter quotes inside the band on a lane, the band is **not widened** to force a placement — at any point in the indent's life, not merely after the first quote arrives (`BR-39`). The shortfall is recorded as a **market gap** and drives lead generation; for lanes being bid at RFQ, the vendor base is built **before** the bid rather than after (`D-19`).

**Out-of-band quotes** (`D-39`, `BR-05`). A quote below the bid minimum is refused at entry — it would run at a loss for the transporter and for the desk, and a transporter who wins on a rate they cannot serve abandons the load. A quote **above** the bid maximum is accepted, stored and shown to the desk marked out-of-band; awarding it requires leadership approval (`BR-40`). Above-band quotes are kept rather than discarded because they are the honest market rate on that lane — the evidence that turns a repeated placement failure into a recorded market gap.

### B3.10 Clients · `MOD-CLI`

**Purpose:** the commercial terms behind every indent. Company and billing details, GSTIN, point of contact, agreement (type, engagement spot or contract, number, validity dates, attachment), credit period, service level, and the **transit days and vehicle reporting requirement** agreed for each lane.

The rate card is **not keyed separately** — it is the set of lanes won at RFQ, carried across with their validity (`D-18`). For a spot client there is no standing card; the rate is set per indent with the client's written approval attached (`D-14`).

### B3.11 Transporter bills · `MOD-VBL`

**Purpose:** the transporter's own bill to us, against a completed trip (`D-37`). Distinct from our tax invoice to the client, which is the next section — the two were being treated as one document.

Raised in the portal once the POD is approved. Carries the transporter's own bill number and date, an attached copy, and the amounts: freight plus any charges agreed on that trip. It is **reverse charge, so no GST** — the portal states this on the form to stop transporters adding tax we cannot claim. Finance matches the bill to the computed balance and any variance is flagged before release.

### B3.12 Invoicing and receivables · `MOD-INV`

- **Customers** — name, GST number, contact, phone, email, billing address, state, PIN, payment terms. Create, search, edit, delete.
- **Invoice builder** — auto number, dates, customer with details pulled forward, consignment details, six charge heads, discount, round off, notes. Save draft or generate. **No tax field appears on this screen** — corrected in v2.2 (`F-04`); v2.1 listed a "GST percentage" field, contradicting `D-06` and `BR-15`.
- **Tax** — this business invoices under the **reverse charge mechanism only** (`D-06`). No GST is added to any invoice. The invoice shows the freight and any client-specific charges, the total, and a declaration that GST is payable by the recipient under reverse charge. Round off to the rupee. Forward charge is **out of scope**.
- **Charges** — freight is always billed. Loading, unloading, detention and other heads are added only where that client's arrangement provides for them (`D-04`). They are captured by the **document verification function** from what is written on the POD, **marked up**, billed to the client and paid on to the transporter (`D-25`). The cost and the billed figure are held separately so the mark-up is visible in the margin.
- **Ledger** — search by invoice number, customer, phone or date; filters for today, this week, this month, paid and pending; per-row print, edit, duplicate, delete; invoice numbers open a full invoice page.
- **Receivables** — record a payment against an invoice with amount, date, mode, UTR or cheque number and remarks. Part payments supported; the invoice moves to part paid and the balance stays in the ageing.
- **Print** — A4, four copies: shipper, consignee, POD, POD duplicate.

### B3.13 Profit and loss · `MOD-PNL`

**Basis** (`D-05`): revenue is the **customer rate** billed for the consignment. Cost is the **placement rate** paid to the transporter **plus every other cost the company incurs on that load** — loading, unloading, detention, halt, labour and any other charge booked against it. Margin is the difference. The flat monthly branch overhead used in the prototype is withdrawn.

Viewable daily, monthly or quarterly over a selectable period, with branch breakdown, trend chart, CSV export and an A4 statement. Because cost is built from actual charge lines rather than an assumed percentage, the margin figure is only as good as the charge capture on each trip — which is why charges are entered against the load and not at month end.

### B3.14 Leads, market gap and issues · `MOD-LED`

A recruitment pipeline (source, claimed fleet, owning desk, stage from New through Qualified to Converted), per-branch capacity targets with gap and progress, and an issues register against existing transporters with category, severity, related LR and status.

## B4 · Business rules catalogue

These are the rules the system enforces. Each is testable and should have an acceptance test.

| ID | Rule | Module |
|---|---|---|
| `BR-01` | A transporter whose compliance file is not cleared shall not appear in the indent assignment list. | Vendor, Indents |
| `BR-02` | Where party type is Owner, the vehicle registration certificate is mandatory; otherwise at least one legal document is required. | Vendor |
| `BR-03` | A TDS declaration is mandatory for every transporter regardless of party type. | Vendor |
| `BR-04` | Only the last four digits of an Aadhaar number shall be retained after OTP verification. | Vendor |
| `BR-05` | A quote **below** the indent's bid minimum shall be rejected at entry. A quote **above** the bid maximum shall be accepted, stored, and presented to the desk marked out-of-band; awarding it requires leadership approval under `BR-40`. *(Rewritten in v2.2 per `D-39`. v2.1 read "A quote outside the indent's bid band shall be rejected at entry", which contradicted `BR-40`.)* | Portal, Indents |
| `BR-06` | Awarding a quote shall assign that transporter and write their quoted rate onto the indent as the buy price. | Indents |
| `BR-07` | The advance shall not be released until the load's mandatory documents (`BR-58`) are uploaded and individually verified. | Indents |
| `BR-08` | The advance amount is fixed at the agreed percentage of the freight and shall not be editable at payment. | Indents |
| `BR-09` | Every payment to a transporter shall record mode, transfer type, remitting account, UTR and value date. | Indents, Trips |
| `BR-10` | The balance shall not be released until the POD is **approved** and all mandatory documents are verified. | Trips |
| `BR-11` | The balance payable is the billable freight less any advance already released. | Trips |
| `BR-12` | A POD is breached when more than 20 days have elapsed since delivery. | POD pending |
| `BR-13` | A lorry receipt may be issued only against an indent whose truck has been placed. Issuing it opens the trip. | Trips |
| `BR-14` | Lorry receipt and invoice numbers shall be drawn from a configured series and the counter incremented on issue. | Control |
| `BR-15` | Freight shall be invoiced under the reverse charge mechanism only. No GST shall be added to any invoice and the invoice shall carry a declaration that tax is payable by the recipient. Forward charge is out of scope. | Invoicing |
| `BR-16` | Recording a receipt equal to or greater than the balance closes the invoice as paid; any lesser amount marks it part paid and leaves the balance in the ageing. | Receivables |
| `BR-17` | An invoice shall print in four copies: shipper, consignee, POD, POD duplicate. | Invoicing |
| `BR-18` | An indent past its pickup date without a placed vehicle is a placement failure and shall be recorded with a cause. | Today |
| `BR-19` | A vehicle exceeding the configured overspeed threshold, exceeding the dark-vehicle ping interval, or holding an e-way bill inside the warning window shall raise an alert. | Telematics |
| `BR-20` | Branch is derived from the pickup location and carries through indent, trip and E-LR unchanged. | All |
| `BR-21` | A trip number shall be generated for every order when the consignment is opened, and shall be distinct from and carried alongside the indent number and the lorry receipt number. | Trips |
| `BR-22` | The lorry receipt and the E-LR are a single record. Electronic sharing shall be optional and shall not be a required step in the workflow. | Trips |
| `BR-23` | Photographs of the PAN card and the Aadhaar card shall be captured during onboarding in addition to number verification. The full Aadhaar number shall not be retained. | Vendor |
| `BR-24` | Where a POD is outstanding beyond 20 days from delivery, a penalty of ₹100 per day on actuals shall accrue from day 21 and be deducted from the balance payable to the transporter. | POD pending |
| `BR-25` | Where a POD is outstanding beyond 40 days from delivery, no payment shall be processed: the balance is forfeited and the trip closed with nothing payable to the transporter. | POD pending |
| `BR-26` | For a spot client, the freight is entered per indent by the indent team and the client's written rate confirmation shall be attached before the indent may be raised. | Indents, Clients |
| `BR-27` | The transit days required by the client shall be captured on the indent and carried to the trip and the lorry receipt. Actual delivery shall be measured against it. | Indents, Trips |
| `BR-28` | A remarks field shall be available on the indent and shall carry through to the trip and the lorry receipt. | Indents, Trips |
| `BR-29` | Access shall be governed by role. Each role holds None, View or Edit on each module, enforced server-side on every request. | All |
| `BR-30` | The advance percentage shall default from the assigned transporter's advance policy agreed at onboarding. | Vendor, Indents |
| `BR-31` | Identity verification shall be performed once per transporter, by API or by compliance review of uploaded document photographs. The route taken and the verifying person shall be recorded. It shall not be repeated per load. | Vendor |
| `BR-32` | The client invoice, e-way bill and lorry receipt shall be cross-checked on their common fields, and any mismatch flagged before dispatch. | Trips |
| `BR-33` | No TDS shall be deducted in this release. The transporter's declaration is held on file. When deduction begins, it shall apply to the amount actually paid, not the whole freight, and shall be remitted by finance through the tax portal. | Indents, Trips |
| `BR-34` | A client address shall map to the nearest branch within a 150 km catchment; where more than one branch qualifies, the mapping may be overridden on demand, supply or geography grounds and the override recorded. | All |
| `BR-35` | Cost for margin purposes shall be the placement rate plus every other charge booked against that consignment. No assumed percentage or blanket overhead shall be used. | P&L |
| `BR-36` | A quoted rate at RFQ shall be built as average sourcing rate plus overheads plus margin, with each component stored against the lane. | RFQ |
| `BR-37` | A lane won at RFQ shall become the client's rate card entry for the RFQ validity period without separate re-entry. | RFQ, Clients |
| `BR-38` | A spot load shall not be quoted below its sourcing cost. The system shall block a loss-making spot quote. | RFQ, Indents |
| `BR-39` | A bid band shall not be widened to force a placement. An unquoted lane shall be recorded as a market gap and raised to lead generation. | Indents, Leads |
| `BR-40` | Only finance may release a payment. A price above the agreed band requires leadership approval. An operational exception requires approval by a role senior to operations. | All |
| `BR-41` | Indenting and document verification shall be grantable permissions attachable to any internal role, not fixed to a department. | All |
| `BR-42` | Failure to report the vehicle by the client's required reporting time shall be recorded as a transit delay, with a remark. | Indents, Trips |
| `BR-43` | A POD penalty may be waived only on compliance proposal and leadership approval, with the reason recorded. | POD pending |
| `BR-44` | A document failing the cross-check shall be rejected for re-upload. Proceeding requires an override with a recorded reason by a role senior to operations. | Trips |
| `BR-45` | Client-specific charges shall be captured from the POD by the document verification function, marked up for billing, and held with cost and billed value separately. | Trips, Invoicing |
| `BR-46` | Identity document images shall be retained for the life of the transporter relationship. | Vendor |
| `BR-47` | Where more than one branch falls within the 150 km catchment, the client's operating location decides; leadership may override the mapping. | All |
| `BR-48` | A proof of delivery shall pass through Pending → Attached → Received → Verified → Approved, with Forfeited as a terminal state past 40 days. | POD |
| `BR-49` | The POD penalty clock shall stop on receipt of the physical copy at the branch, not on attachment in the portal. | POD |
| `BR-50` | The user approving a POD shall not be the user who verified it. | POD |
| `BR-51` | Attaching a POD shall require a courier docket number and a sent-on date. No scanning or edge detection is required. | Portal |
| `BR-52` | Rejecting a POD at verification shall return it to the transporter for replacement and shall not stop the penalty clock. | POD |
| `BR-53` | A transporter bill may be submitted only after the POD is approved, and shall be matched to the computed balance with any variance flagged before release. | Portal, Payments |
| `BR-54` | The lorry receipt shall be visible and downloadable by the assigned transporter, redacted of consignor, consignee, client name and sell rate. | Portal |
| `BR-55` | Data sent to a transporter shall exclude client name, sell rate, other transporters' quotes and quote counts by construction, not by interface suppression. | Portal |
| `BR-56` | Charges written on the POD shall be captured at the point of verification. | POD, Trips |
| `BR-57` | A change to a transporter's advance policy percentage, and any indent-level departure from it, shall require approval by a role senior to operations, with the reason recorded. *(New in v2.2 — `D-22` mandated this but no rule carried it.)* | Vendor, Indents |
| `BR-58` | The advance document set shall be: client invoice or purchase order, e-way bill, vehicle registration certificate, goods insurance, **fitness certificate**, **permit**, **pollution certificate**, and driver's licence. The set shall be configurable in the control panel and seeded with those eight. *(New in v2.2 — extracted from `BR-07`, which named no documents; fitness, permit and PUC were named in A5 but omitted from every downstream specification.)* | Indents, Trips |

> **Corrected in v2.2 (`F-07`).** The v2.1 source listed `BR-47`, `BR-18`, `BR-19` and `BR-20` after `BR-56` rather than in sequence. They are in numeric order here. No rule was renumbered. The catalogue now holds **58** rules, `BR-01` through `BR-58`, with none missing.

## B5 · Data dictionary

| Entity | Key attributes | Relationships |
|---|---|---|
| **Vendor** | Code, name, party type, base city, fleet base, GSTIN, PAN, phone, alternate, trucks, operating states, KYC flags, legal document flags, TDS declaration and basis, bank account, IFSC, bank statement, status, verified by, panel date, rating | Has many fleet vehicles, quotes, trips, issues |
| **Client** | Code, name, billing city, GSTIN, point of contact, agreement (type, spot or contract, number, validity), rate card lines, credit days, service level, status | Has many indents, invoices |
| **Indent** | ID, client, from, to, material, weight, truck type, pickup date, **transit days required**, **remarks**, freight, **rate source and spot rate confirmation attachment**, bid minimum and maximum, advance %, branch, stage, transporter, documents, verification flags, advance payment | Has many quotes; becomes one trip |
| **Quote** | ID, indent, transporter, amount, truck offered, remarks, status | Belongs to one indent |
| **Trip** | **Trip number**, LR number, indent reference, client, transporter, vehicle and type and capacity, driver and licence, branch, lane, weight, **transit days required**, **actual transit days**, **remarks**, freight, detention, vendor cost, e-way bill, status, progress, POD status and date, **POD penalty accrued**, **POD closure basis**, documents, verification flags, balance payment, billed flag | Belongs to one indent; holds one lorry receipt; appears on invoices |
| **POD receipt** | Trip, courier docket, sent-on date, received-on date, pages, received by, condition, attachments, verified by and at, verification checklist result, approved by and at, rejection reason | One per trip; may supersede a rejected predecessor |
| **Transporter bill** | Trip, vendor, their bill number and date, attachment, freight and charge lines, total, submitted at, matched-to-balance variance, status | Belongs to one trip and one vendor |
| **Lorry receipt** | LR number, booking date and time, LR date, branch, consignor, consignee, pickup and delivery, goods, invoice and e-way bill, vehicle, driver, transit days, remarks, six charge heads, status, shared-on (optional) | Held within the trip — not a separate document type |
| **Invoice** | Number, customer, dates, consignment, six charge heads, discount, **tax mechanism (reverse charge by default)**, taxable, round off, total, received, status. Tax component fields are retained but nil under reverse charge. | Covers one or many trips; has many receipts |
| **Receipt** | Number, invoice, customer, amount, date, mode, reference, remarks | Belongs to one invoice |
| **Fleet vehicle** | Registration, type, capacity, current location, free-from date, status | Belongs to one vendor |
| **Lead** | ID, name, city, source, party type, trucks claimed, phone, owner, stage, notes | May convert to a vendor |
| **Issue** | ID, vendor, category, severity, raised date and by, related LR, status, note | Belongs to one vendor |

## B6 · Numbering and documents

| Document | Series | Notes |
|---|---|---|
| Trip | `TRP-100241` | Generated for every order when the consignment is opened. Internal operational reference. |
| Lorry receipt | `LR-88215` | Prefix and next number configurable. Consumed on issue. Appears on the legal document. |
| Tax invoice | `NEX-INV-000001` | Prefix and next number configurable, six digits. |
| Indent | `IND-30787` | Sequential. |
| Vendor / client / customer | `VND-` · `CLT-` · `CUS-` | Sequential per master. |
| POD receipt | `PDR-` | Sequential per branch. |
| Quote · Receipt · Lead · Issue | `BID-` · `RCT-` · `LD-` · `IS-` | Sequential. |

**Printed documents:** the **lorry receipt** (A4, letterhead with GSTIN, PAN and CIN, consignor and consignee, goods, vehicle, driver, charge breakdown, terms, Code 39 barcode, three signature blocks) and the **tax invoice** (A4, four copies — shipper, consignee, POD, POD duplicate — charge table, reverse charge declaration, terms, barcode, authorised signature). Both carry company details maintained in the control panel.

## B7 · Integrations required

| Integration | Purpose | Priority |
|---|---|---|
| **KYC agency** | PAN name-match and Aadhaar OTP verification through a licensed provider. **Optional** (`D-08`) — where per-check cost is not justified, compliance verifies uploaded photographs manually instead. Build the manual route first; the API is an accelerator, not a dependency. | Medium |
| **NIC e-way bill** | Fetch number, validity and status rather than typing them; detect extension and cancellation | High |
| **GPS / telematics provider** | Live position, speed, fuel, halt detection | High |
| **Document storage** | Object storage for every uploaded document, with retention | High — nothing stores files today |
| **Messaging gateway (SMS / WhatsApp)** | Booking confirmation, LR delivery, status updates, POD chasing. **DLT registration is already complete, TRAI approval obtained and a gateway integrated** (`D-31`). Without DLT registration no gateway integration is possible at all, so this dependency is met. What remains is registering the message templates and deciding which events send. | Ready |
| **Banking** | Payment initiation and automatic UTR capture; currently keyed by hand | Medium |
| **Accounting system** | Invoice and receipt reconciliation into the books of account | Medium |
| **GSTN** | GSTIN validation on vendor and client onboarding | Low |

## B8 · Non-functional requirements

| ID | Requirement |
|---|---|
| `NFR-01` | All access control shall be enforced server-side on every request. Interface-level control alone is not acceptable. |
| `NFR-02` | A transporter shall never be able to see another transporter's rates, quotes, loads or fleet. |
| `NFR-03` | Every payment release, document verification, quote award and status change shall be recorded in an immutable audit trail with actor and timestamp. |
| `NFR-04` | Aadhaar numbers shall not be stored in full. Retention of identity documents shall follow the advice of the company's compliance advisers. |
| `NFR-05` | Sizing baseline (`D-30`): **150–200 vehicles placed per month** across the business, averaged over the year, rising approximately 1.5× through the February to June peak. The system shall carry that comfortably, with at least 20 concurrent internal users and 200 transporter accounts. The architecture shall not preclude an order-of-magnitude increase, but the first release shall not be provisioned for one. |
| `NFR-06` | Screens shall be usable on a tablet and a phone; the transporter portal in particular will be used on a phone. |
| `NFR-07` | Financial data shall be backed up daily with a documented restore procedure and a tested recovery time objective. |
| `NFR-08` | Document numbering shall be gap-free and shall not issue duplicates under concurrent use. |
| `NFR-09` | Monetary amounts shall be **stored as integer paise** and never as a floating-point type. They shall be **displayed and rounded to the rupee**, with explicit rounding applied at the invoice level only — intermediate figures (charge lines, penalty accrual, advance split, margin) round nowhere. *(Amended in v2.2. v2.1 said only "held to the rupee with explicit rounding at the invoice level only", which Spec 1 read as paise and Spec 2 left unstated. Integer paise satisfies both: it is exact, and rupee rounding at the invoice is a presentation and totalling step.)* |
| `NFR-10` | The system shall retain records for the period required by GST and income-tax law. |
| `NFR-11` | Peak load in February to June — approximately 1.5× the average — shall be handled without degradation. |
| `NFR-12` | There is no legacy system to migrate from (`D-15`). Opening balances, the transporter panel and the client master shall be loaded by controlled import at go-live. |

## B9 · Decisions and sign-off

Thirty-nine decisions, taken across four review rounds, recorded here so the reasoning survives and written into the body of the specification as rules. **No open points remain.** Two decisions supersede earlier ones and are marked where they appear.

> **Corrected in v2.2 (`F-01`, `F-02`).** The v2.1 source said *"Thirty-one decisions, taken across two review rounds"* and its tables stopped at `D-31` — the seven v2.1 decisions that define the entire POD chain (`D-32`–`D-38`) appeared only in the revision history and were absent from this register, even though document control claimed thirty-eight were recorded here. All are now present, and `D-39` resolves the one question v2.1 left open while simultaneously asserting there were none.

### Decisions taken

| Ref | Decision | Written into |
|---|---|---|
| `D-01` | Role-based permissions are mandatory. Every user sees and does only what their role allows, enforced server-side. | B2 · `BR-29` · `NFR-01` |
| `D-02` | Buy price follows the market. Monthly rates are published at RFQ for contract lanes; spot loads are quoted after checking the sourcing rate at that moment. | B3.3 |
| `D-03` | The advance policy is agreed at vendor onboarding and held on the transporter's file; it defaults onto every indent placed with them. | B3.1 · `BR-30` |
| `D-04` | Cost is freight. Loading, unloading, detention and other heads are added only where the client's arrangement requires them. | B3.10 |
| `D-05` | The P&L carries the placement rate plus every cost the company incurs on the load, against the customer rate. The assumed overhead allocation is withdrawn. | B3.11 · `BR-35` |
| `D-06` | Invoicing is under reverse charge only. Forward charge is out of scope. | B1 · B3.10 · `BR-15` |
| `D-07` | ~~TDS deduction is mandatory, managed through the transporter's declaration.~~ **Superseded by `D-24` — do not build to this.** | *(none — see `D-24`)* |
| `D-08` | Identity is verified once, not per load. Where API cost is not justified, compliance verifies uploaded photographs manually. | B3.1 · B7 · `BR-31` |
| `D-09` | The client invoice, e-way bill and lorry receipt must be exact and consistent — errors are penalised on the road. | B3.4 · `BR-32` |
| `D-10` | POD turnaround is 20 days; ₹100 per day thereafter; beyond 40 days no payment is processed. | B3.6 · `BR-24` · `BR-25` |
| `D-11` | Our team raises every indent from requirements received by email or WhatsApp. Client self-service is out of scope this phase. | B1 |
| `D-12` | A branch serves a 150 km catchment; client addresses map to the nearest qualifying branch, adjusted for demand, supply and geography. | `BR-34` |
| `D-13` | ~~Each branch places 500+ trucks, rising in the February to June peak.~~ **Superseded by `D-30` — do not size to this.** | *(none — see `D-30`)* |
| `D-14` | For spot clients the rate approval — the client's email or WhatsApp confirmation — must be attached at indent creation. | B3.3 · `BR-26` |
| `D-15` | There is no system to replace. DLT registration is complete; a messaging gateway must be integrated. | B7 · `NFR-12` |

### Second round — decisions taken in version 2.0

| Ref | Decision | Written into |
|---|---|---|
| `D-16` | Finance alone releases payments. A price above the band needs leadership approval. An operational exception needs approval from a role senior to operations. | B2 · `BR-40` |
| `D-17` | Indenting and document verification are grantable permissions, not fixed departments. | B2 · `BR-41` |
| `D-18` | Lanes are won at RFQ on the client's own 3, 6 or 12-month cycle. Quote = average sourcing rate + overheads + margin. Lowest bid wins; the won lane becomes the rate card. | B3.9 · `BR-36` · `BR-37` |
| `D-19` | A band with no quotes is a market gap, not a licence to widen. It drives lead generation; for RFQ lanes the vendor base is built before bidding. | B3.9 · `BR-39` |
| `D-20` | A spot load is never quoted at a loss. Operations supplies the sourcing rate and the quote is built from it. | B3.9 · `BR-38` |
| `D-21` | Vehicle reporting time is a client requirement in its own right; failing it is a transit delay, recorded with a remark. | B3.3 · `BR-42` |
| `D-22` | Advance percentage is a standard maintained by compliance; urgent-load override permitted with approval. | B3.1 |
| `D-23` | POD penalty waiver: compliance proposes, leadership approves, reason recorded. | B3.6 · `BR-43` |
| `D-24` | No TDS deducted in this release; the declaration is held. When deduction starts it applies to the amount paid, not the whole freight, and finance remits through the portal. **Supersedes `D-07`.** | B1 · `BR-33` |
| `D-25` | Client-specific charges are captured from the POD by document verification, marked up, billed and paid on. Cost and billed value held separately. | B3.11 · `BR-45` |
| `D-26` | Reverse charge applies for this entity's lifetime. Forward charge would need a separate GST registration under a separate entity — a later phase. | B1 |
| `D-27` | Identity document images are retained for the life of the transporter relationship. | B3.1 · `BR-46` |
| `D-28` | A failed document cross-check rejects the document for re-upload; an override requires a recorded reason from a role senior to operations; our own errors are corrected in the system. | B3.4 · `BR-44` |
| `D-29` | Branch overlap is decided by the client's operating location; leadership may override. | `BR-47` |
| `D-30` | Placement volume is 150–200 vehicles a month, 1.5× at peak. 500+ per branch is a head-office ambition needing capital in crores, not the sizing basis. **Supersedes `D-13`.** | `NFR-05` · `NFR-11` |
| `D-31` | DLT registration and TRAI approval complete; a messaging gateway is integrated. Template registration and event selection remain as build tasks. | B7 |

### Third round — decisions taken in version 2.1 (the POD chain)

*Added to this register in v2.2 (`F-01`). These seven were taken in v2.1 but recorded only in the revision history.*

| Ref | Decision | Written into |
|---|---|---|
| `D-32` | The POD has five states, not two: Attached → Received at branch → Verified → Approved, with Forfeited outside the chain. Each transition has a different owner. | B3.6 · `BR-48` |
| `D-33` | No scanner — plain attachment. A courier docket number and a sent-on date are mandatory, because they are how the branch matches next week's paper to today's file. | B3.6 · `BR-51` |
| `D-34` | Verifying and approving are separate acts. Verifying is a clerical check; approving is the decision to pay. The approver must be a different person. | B3.6 · `BR-50` |
| `D-35` | The penalty clock stops at branch receipt, not at attachment. If a photograph stopped the clock the paper would never arrive; the transporter carries the risk of a slow courier. | B3.6 · `BR-49` |
| `D-36` | The lorry receipt is visible in the portal, redacted — no consignor, consignee or client name, and never our sell rate. | B3.2 · `BR-54` |
| `D-37` | A transporter's bill is not our invoice. The transporter bills us; we bill the client. Both under reverse charge, neither carrying GST. | B3.11 · `BR-53` |
| `D-38` | Portal data is redacted at the source. Client name, sell rate and quote count are absent from the payload, not hidden in the interface. | B3.2 · `BR-55` · `NFR-02` |

### Fourth round — decision taken in version 2.2

| Ref | Decision | Written into |
|---|---|---|
| `D-39` | A quote below the bid minimum is refused at entry. A quote above the bid maximum is accepted and flagged out-of-band; awarding it requires leadership approval. Refusing above-band quotes outright would hide the true market rate on a lane, which is the signal `D-19` relies on to declare a market gap. **Resolves the question left open in v2.1 document control** (`Q-16` in Spec 1). | B3.9 · `BR-05` · `BR-40` |

> **No open points remain.** Every question raised in versions 1.0 and 1.2 has been answered. Three items are **deliberately deferred** rather than unresolved, and none blocks this build: the forward-charge entity and its GST registration (`D-26`), the specific messaging templates and which events send them (`D-31`), and whether indenting sits with a dedicated team, compliance or operations — which the permission model makes a configuration choice rather than a design one (`D-17`).

### Build risks to manage

These are not questions for the business; they are things the build team must handle well.

| Ref | Risk | Mitigation |
|---|---|---|
| `R-01` | Margin accuracy depends entirely on charge capture from the POD. If the desk does not enter loading, unloading and detention against the load, the P&L understates cost and overstates margin. | Make charge entry part of POD verification, not a separate step. Report loads closed with no charges captured. |
| `R-02` | Forfeiting a transporter's balance at 40 days is commercially severe and may damage supply on thin lanes. | Report forfeitures by transporter monthly; treat a pattern as a supply problem, not just a compliance win. |
| `R-03` | The RFQ quote build-up is only as good as the sourcing rate operations supplies. A soft rate wins a lane that cannot be served. | Store the sourcing rate with the quote and compare it against actual placement rates once the lane runs. |
| `R-04` | Retaining Aadhaar images for the life of the relationship raises a data-protection obligation that grows with the panel. | Encrypt at rest, restrict access to compliance, and delete on relationship closure as a scheduled job. |
| `R-05` | The prototype is now behind this specification in four places — no roles, GST still calculated, the old 30-day POD rule, and no RFQ module. | Treat the prototype as a design reference, not a starting codebase, for those four areas. |

### Sign-off

This specification is locked at version 2.2. Changes from here should be raised as change requests against a numbered requirement or business rule, not as amendments to the narrative.

| Role | Name | Date |
|---|---|---|
| Leadership | | |
| Operations | | |
| Finance | | |
| Compliance | | |

## B10 · Glossary

| Term | Meaning |
|---|---|
| **Advance** | Part of the freight paid to the transporter at placement, before delivery. |
| **Bid band** | The minimum and maximum a transporter may quote on an indent. |
| **Consignor / consignee** | The party sending the goods / the party receiving them. |
| **Detention** | A charge for holding a truck beyond agreed free hours at loading or unloading. |
| **E-way bill** | Government electronic permit for moving goods above a value threshold, with a hard expiry. |
| **Indent** | A recorded request for a truck, raised before any vehicle is found. |
| **Lorry receipt (LR)** | The contract of carriage issued against a consignment. E-LR is the digital form. |
| **Market gap** | A branch's shortfall of transporter capacity on a lane it struggles to cover. |
| **Owner / Vendor** | A transporter running trucks in its own name / one attaching other owners' trucks. |
| **Placement** | Getting a physical vehicle to the pickup point for an indent. |
| **POD** | Proof of Delivery — the receipted document confirming the goods arrived. |
| **RFQ** | Request for quotation — a client's periodic tender for its lanes, awarded to the lowest bid. |
| **Sourcing rate** | What it costs to buy a truck on a lane in the market at a given time. |
| **TAT** | Turnaround time. Here, the 20 days allowed to collect a POD after delivery. |
| **TDS** | Tax deducted at source on payments to transporters, under section 194C. |
| **UTR** | Unique Transaction Reference — the bank's identifier for an electronic payment. |

---

## Document control

Version 2.2, 10 August 2026. Supersedes 2.1 (August 2026), which superseded 2.0.

**Thirty-nine decisions** are recorded in section B9, `D-01` through `D-39`. `D-24` supersedes `D-07` on TDS; `D-30` supersedes `D-13` on scale; `D-32` to `D-38` extend the proof-of-delivery lifecycle following review of the transporter portal design; `D-39` resolves the one question v2.1 left open, on how a quote above the bid maximum is handled. **No question is open.**

**Fifty-eight business rules** (`BR-01`–`BR-58`) and **twelve non-functional requirements** (`NFR-01`–`NFR-12`) are numbered here. `BR-57` and `BR-58` are new in v2.2; `BR-05` and `NFR-09` are amended. Five build risks (`R-01`–`R-05`), seven actors (`ACT-*`) and fourteen modules (`MOD-*`) complete the identifier set. Every reference used by Spec 1 and Spec 2 resolves to this document.

Version 2.2 applies nine corrections to defects in the v2.1 source, each listed with its original wording in *Corrections applied in v2.2* at the head of this document. The v2.1 PDF remains the historical record; this file supersedes it for build purposes.

Prepared as the functional specification for the Nexraah freight operations platform, describing a completed working prototype and the production build that follows it. All figures shown in examples are illustrative. Sections A8, A9 and B9 state plainly what is not yet built and what remains deferred; they should be read before any commitment is made on the strength of this document.

### Identifier index

| Prefix | Range | Meaning | Section |
|---|---|---|---|
| `D-` | `D-01`–`D-39` | Business decisions taken, with reasoning | B9 |
| `BR-` | `BR-01`–`BR-58` | Business rules the system enforces; each needs an acceptance test | B4 |
| `NFR-` | `NFR-01`–`NFR-12` | Non-functional requirements | B8 |
| `R-` | `R-01`–`R-05` | Build risks for the delivery team to manage | B9 |
| `ACT-` | 7 actors | Roles and their responsibilities | B2 |
| `MOD-` | 14 modules | Module specifications | B3 |
| `PERM-` | `PERM-INDENT`, `PERM-DOCVERIFY` | Functions grantable to any internal role (`D-17`) | B2 |
