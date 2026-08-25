import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, PortalDb } from '../../db/kysely';

export interface PortalLoadFilters {
  /** Comma-separated on the wire (`FE.md` §7 Q2), already split by the service. */
  truckTypes?: string[];
  branchId?: string;
}

/**
 * Layer three of `vendor-specs/02-redaction-contract.md` §3 — repository
 * scoping. Every method here takes `vendorId` as its first argument and puts it
 * in the `where` clause. **There is no override parameter and there must never
 * be one**: a `vendorId?: string` that falls back to "all" is one careless call
 * site away from being the leak the whole contract exists to prevent.
 *
 * Layer one is the column list. Nothing below names `indents.client_id`,
 * `indents.sell_rate`, `indents.sourcing_rate` or `indents.buy_rate` — they are
 * absent from `vendor_api`'s grant (`20260814090200` §2) and would raise at the
 * database, but the query is written so that never happens.
 */
@Injectable()
export class PortalLoadsRepository {
  constructor(@Inject(DB) private readonly db: PortalDb) {}

  transaction() {
    return this.db.transaction();
  }

  /**
   * `03-P2` §1: loads are matched to "the vendor's operating states and fleet
   * types". The fleet half is this list. (The operating-states half has no
   * counterpart to match against — `indents` carries `from_city`/`to_city` and
   * no state column — so it is not applied; see `portal-loads.service.ts`.)
   */
  async fleetTruckTypes(vendorId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom('vendor_fleet')
      .select('type')
      .distinct()
      .where('vendor_id', '=', vendorId)
      .execute();
    return rows.map((r) => r.type);
  }

  /**
   * Open indents this vendor may bid on.
   *
   * `stage = 'OPEN'` and `vendor_id is null` together are `BR-55` as a query:
   * "A load awarded to someone else disappears from the list. It does not
   * appear as lost, outbid, or filled." There is no `LOST` branch to write
   * because there is no row left to write it from.
   */
  listOpen(vendorId: string, truckTypes: string[], filters: PortalLoadFilters) {
    let query = this.baseLoadQuery(vendorId)
      .where('indents.stage', '=', 'OPEN')
      .where('indents.vendor_id', 'is', null);

    query = query.where(
      sql<string>`lower(btrim(indents.truck_type))`,
      'in',
      truckTypes.map((t) => t.trim().toLowerCase()),
    );

    if (filters.truckTypes?.length) {
      query = query.where(
        sql<string>`lower(btrim(indents.truck_type))`,
        'in',
        filters.truckTypes.map((t) => t.trim().toLowerCase()),
      );
    }
    if (filters.branchId) {
      query = query.where('indents.branch_id', '=', filters.branchId);
    }

    return query.orderBy('indents.pickup_date', 'asc').execute();
  }

  /**
   * `FE.md` §1: "`404` when the code is unknown **or not offered to this
   * vendor** — never 403." Same predicate as the list, so a load the list would
   * not show cannot be deep-linked into either.
   */
  findOpenByCode(vendorId: string, code: string, truckTypes: string[]) {
    return this.baseLoadQuery(vendorId)
      .where('indents.stage', '=', 'OPEN')
      .where('indents.vendor_id', 'is', null)
      .where('indents.code', '=', code)
      .where(
        sql<string>`lower(btrim(indents.truck_type))`,
        'in',
        truckTypes.map((t) => t.trim().toLowerCase()),
      )
      .executeTakeFirst();
  }

  /**
   * The `myQuote` join. `on('quotes.vendor_id', '=', vendorId)` sits in the
   * JOIN condition rather than the WHERE clause on purpose: in the WHERE it
   * would turn the LEFT JOIN into an inner one and drop every load the vendor
   * has not quoted yet.
   */
  private baseLoadQuery(vendorId: string) {
    return this.db
      .selectFrom('indents')
      .leftJoin('quotes', (join) =>
        join
          .onRef('quotes.indent_id', '=', 'indents.id')
          .on('quotes.vendor_id', '=', vendorId)
          .on('quotes.status', '=', 'SUBMITTED'),
      )
      .select([
        'indents.code as code',
        'indents.from_city as originCity',
        'indents.to_city as destinationCity',
        'indents.truck_type as truckType',
        'indents.weight_kg as weightKg',
        'indents.material as material',
        'indents.transit_days as transitDays',
        'indents.reporting_rule as reportingRule',
        'indents.remarks as remarks',
        'indents.pickup_date as pickupDate',
        'indents.bid_min as bidMinPaise',
        'indents.bid_max as bidMaxPaise',
        'indents.advance_pct as advancePct',
        'quotes.id as myQuoteId',
        'quotes.amount as myQuoteAmountPaise',
        'quotes.band_position as myQuoteBandPosition',
      ]);
  }

  /**
   * `GET /portal/quotes` — theirs only. The join reaches `indents` for the load
   * code and lane and for `bid_max`, which the band overshoot is measured
   * against; `bid_max` is a number the transporter is already shown on the load
   * card, so echoing the gap discloses nothing new.
   */
  listQuotes(vendorId: string) {
    return this.db
      .selectFrom('quotes')
      .innerJoin('indents', 'indents.id', 'quotes.indent_id')
      .leftJoin('trips', (join) =>
        join
          .onRef('trips.indent_id', '=', 'quotes.indent_id')
          .on('trips.vendor_id', '=', vendorId),
      )
      .select([
        'quotes.id as id',
        'indents.code as loadCode',
        'indents.from_city as originCity',
        'indents.to_city as destinationCity',
        'indents.stage as indentStage',
        'indents.bid_max as bidMaxPaise',
        'quotes.amount as amountPaise',
        'quotes.status as status',
        'quotes.band_position as bandPosition',
        'quotes.submitted_at as submittedAt',
        'trips.id as tripId',
        'trips.code as tripCode',
      ])
      .where('quotes.vendor_id', '=', vendorId)
      .orderBy('quotes.submitted_at', 'desc')
      .execute();
  }

  // ── Writes — 11-portal.md §5.2 ──────────────────────────────────────────

  /**
   * The indent a quote is being submitted against, by code, with no `stage` or
   * `vendor_id` predicate — the service needs to tell `409 LOAD_CLOSED` (it was
   * open when the screen rendered and has since been awarded) from `404` (never
   * offered to this vendor), and a query that filters both away can only say
   * `404`.
   *
   * Only granted columns are named. `sell_rate`, `client_id`, `sourcing_rate`
   * and `buy_rate` would raise at the database and are not wanted anyway: a
   * band check needs the band, and the band is `bid_min`/`bid_max`.
   */
  findIndentByCode(code: string) {
    return this.db
      .selectFrom('indents')
      .select([
        'id',
        'code',
        'truck_type as truckType',
        'stage',
        'vendor_id as awardedVendorId',
        'bid_min as bidMinPaise',
        'bid_max as bidMaxPaise',
      ])
      .where('code', '=', code)
      .executeTakeFirst();
  }

  /**
   * `quotes` is `unique (indent_id, vendor_id)` — one row per vendor per load,
   * whatever its status. `409 QUOTE_EXISTS` is that constraint surfacing before
   * the insert rather than as a duplicate-key error after it.
   */
  findQuoteForIndent(db: DbExecutor, vendorId: string, indentId: string) {
    return db
      .selectFrom('quotes')
      .select(['id', 'status', 'amount as amountPaise', 'band_position as bandPosition'])
      .where('vendor_id', '=', vendorId)
      .where('indent_id', '=', indentId)
      .executeTakeFirst();
  }

  /**
   * `portal_quote_code_seq`, not `NumberingService`.
   * `20260824090000_c_portal_idempotency.sql` explains why: `number_series` is
   * in `vendor_api`'s blanket `REVOKE ALL`, deliberately, and a quote code is
   * not one of `NFR-08`'s gapless legal series. The `-P` infix keeps this
   * sequence's output disjoint from the console's `BID-00001` on the same
   * `quotes.code` unique index.
   */
  insertQuote(
    db: DbExecutor,
    row: {
      indentId: string;
      vendorId: string;
      amountPaise: number;
      truckRegistration: string | null;
      remarks: string | null;
      bandPosition: string;
    },
  ) {
    return db
      .insertInto('quotes')
      .values({
        code: sql<string>`'BID-P' || lpad(nextval('portal_quote_code_seq')::text, 5, '0')`,
        indent_id: row.indentId,
        vendor_id: row.vendorId,
        amount: row.amountPaise,
        truck_registration: row.truckRegistration,
        remarks: row.remarks,
        band_position: row.bandPosition,
        status: 'SUBMITTED',
      })
      .returning(['id', 'code', 'amount as amountPaise', 'status', 'band_position as bandPosition'])
      .executeTakeFirstOrThrow();
  }

  /** `vendor_id` in the predicate, so another vendor's quote id simply misses. */
  findOwnQuoteById(db: DbExecutor, vendorId: string, quoteId: string) {
    return db
      .selectFrom('quotes')
      .select(['id', 'status', 'indent_id as indentId'])
      .where('id', '=', quoteId)
      .where('vendor_id', '=', vendorId)
      .executeTakeFirst();
  }

  /**
   * `vendor_api` holds `update (status)` on `quotes` and nothing wider
   * (`20260814090200` §2) — "scoped to the one column so a withdrawal cannot
   * become a price edit after the band check has already passed". The `status`
   * predicate makes this a compare-and-set: two concurrent withdrawals, and the
   * second updates no row.
   */
  async withdrawQuote(db: DbExecutor, vendorId: string, quoteId: string): Promise<boolean> {
    const result = await db
      .updateTable('quotes')
      .set({ status: 'WITHDRAWN' })
      .where('id', '=', quoteId)
      .where('vendor_id', '=', vendorId)
      .where('status', '=', 'SUBMITTED')
      .executeTakeFirst();
    return (result?.numUpdatedRows ?? 0n) > 0n;
  }
}
