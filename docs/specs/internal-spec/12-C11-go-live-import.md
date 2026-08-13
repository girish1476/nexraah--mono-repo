# Part 12 · Go-live import — wave C11

| | |
|---|---|
| **Wave** | C11 — last, because it must load into a schema that has stopped moving |
| **Depends on** | Every other part |
| **Rules owned** | `NFR-12` |
| **Screens** | `/admin/import` · `config.manage` |

`NFR-12`. There is **no legacy system to migrate from** (`D-15`), but three data sets must be loaded before the first live day, by controlled import rather than by hand — the transporter panel alone is hundreds of vendors.

---

## 1 · The three sets

| Set | Contents | Validation |
|---|---|---|
| **Transporter panel** | Vendor master with KYC state, advance policy, bank details, fleet | Every row lands at `PENDING_VERIFICATION` at most. **Import can never set `ACTIVE`** — `BR-01` is not bypassable by CSV |
| **Client master** | Clients, agreements, credit terms, rate card lanes with validity | Rate card lanes import against a **synthetic closed RFQ**, so `BR-37` provenance holds and part 02 §3's `NOT NULL` is satisfiable |
| **Opening balances** | Outstanding advances, unbilled trips, open invoices and their ageing | Must reconcile to a control total supplied with the file; a mismatch **aborts the entire import** |

The first row is the important one. `BR-01` is the gate the whole supply side hangs on — a transporter cleared by spreadsheet is exactly the hole the platform exists to close, and an import path that can write `ACTIVE` reopens it on day one.

---

## 2 · The process

```
upload → dry-run report → confirm → commit
```

**Dry-run report:** row count, rejects with reasons, control totals. Nothing is written.

**Commit:** all inside one transaction. A partial import is not a state this system has.

Every imported row carries `source = 'IMPORT'` and the batch id, so a bad batch is identifiable and reversible after the fact. The import is audited as a **single event with the file hash** (part 01 §8.1, class `IMPORT`).

`attachments.sha256` (part 02 §1) exists partly for this — a re-run of the same file is recognisable rather than duplicated.

---

## 3 · Endpoints

```
POST /admin/import/:set          config.manage   multipart, returns batch id + dry-run report
POST /admin/import/:set/commit   config.manage   { batchId }  one transaction
GET  /admin/import/history       batches, actor, file hash, row counts
```

`:set` is one of `vendors`, `clients`, `opening-balances`.

---

## 4 · Ordering

The sets are dependent and must import in this order:

1. **Clients** — the synthetic RFQ and its lanes must exist before any rate card line
2. **Transporter panel** — vendors and their fleet
3. **Opening balances** — references both, and reconciles to a control total

Attempting a set out of order fails the dry run with the missing dependency named.

---

## 5 · Done when

- [ ] An import row claiming `status = ACTIVE` lands at `PENDING_VERIFICATION` and the report says so (`BR-01`, `NFR-12`)
- [ ] Rate card lanes import with a real `rfq_lane_id` against the synthetic closed RFQ (`BR-37`)
- [ ] An opening-balance file whose control total does not reconcile aborts the whole import, writing nothing
- [ ] Dry run writes nothing, ever
- [ ] Commit is one transaction — a failure halfway leaves the database untouched
- [ ] The audit row carries the file hash and the batch id
- [ ] Re-running the same file is detectable

**Tests** (part 13 §23): 18.
