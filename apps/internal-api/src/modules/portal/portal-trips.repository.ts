import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, PortalDb } from '../../db/kysely';
import { PORTAL_POD_CODE_PREFIX } from './portal.constants';

/** Postgres-shaped uuid, so `:id` can be either the trip code or the row id. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Vendor-scoped by construction — `where('trips.vendor_id', '=', vendorId)` is
 * in the base query, not in a caller's hands (`02-redaction-contract.md` §3,
 * layer three).
 *
 * The column lists are `vendor_api`'s grant and no more. Not selected, and not
 * selectable: `trips.client_id`, `trips.billed`, `trips.branch_id`,
 * `trips.pod_closure_basis`, `indents.sell_rate`, `lorry_receipts.consignor`,
 * `lorry_receipts.consignee`, `lorry_receipts.invoice`, `lorry_receipts.charges`.
 */
@Injectable()
export class PortalTripsRepository {
  constructor(@Inject(DB) private readonly db: PortalDb) {}

  transaction() {
    return this.db.transaction();
  }

  list(vendorId: string, stages?: string[]) {
    let query = this.baseTripQuery(vendorId);
    if (stages?.length) query = query.where('trips.stage', 'in', stages);
    return query.orderBy('trips.delivered_at', 'desc').orderBy('trips.code', 'desc').execute();
  }

  /**
   * `:id` is whatever the trip list handed out, which is `trips.code` — the
   * number the transporter reads off the screen and quotes on the phone. A row
   * id is accepted too so a caller holding one is not told the trip does not
   * exist.
   */
  findOne(vendorId: string, idOrCode: string) {
    const query = this.baseTripQuery(vendorId);
    return (UUID.test(idOrCode)
      ? query.where('trips.id', '=', idOrCode)
      : query.where('trips.code', '=', idOrCode)
    ).executeTakeFirst();
  }

  /**
   * `BR-54` / `D-36`: the LR is visible because the transporter physically
   * carries it. `consignor` and `consignee` are absent from the select list and
   * from the grant — the printed document names both, this payload does not.
   */
  findLorryReceipt(vendorId: string, idOrCode: string) {
    const query = this.db
      .selectFrom('lorry_receipts')
      .innerJoin('trips', 'trips.id', 'lorry_receipts.trip_id')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .select([
        'lorry_receipts.code as lrNo',
        'lorry_receipts.booked_at as issuedAt',
        'lorry_receipts.goods as goods',
        'lorry_receipts.transit_days as lrTransitDays',
        'lorry_receipts.eway as eway',
        'indents.from_city as originCity',
        'indents.to_city as destinationCity',
        'trips.id as tripId',
        'trips.code as tripCode',
        'trips.weight_kg as weightKg',
        'trips.vehicle_type as vehicleType',
        'trips.vehicle_no as vehicleRegistrationNo',
        'trips.driver_name as driverName',
        'trips.driver_licence as driverLicenceNo',
        'trips.transit_days_required as transitDaysRequired',
        'trips.eway_no as ewayBillNo',
        'trips.eway_valid_till as ewayValidUpto',
        'trips.buy_rate as freightPaise',
        'trips.advance_paid as advancePaise',
      ])
      .where('trips.vendor_id', '=', vendorId);

    return (UUID.test(idOrCode)
      ? query.where('trips.id', '=', idOrCode)
      : query.where('trips.code', '=', idOrCode)
    ).executeTakeFirst();
  }

  private baseTripQuery(vendorId: string) {
    return this.db
      .selectFrom('trips')
      .innerJoin('indents', 'indents.id', 'trips.indent_id')
      .leftJoin('lorry_receipts', 'lorry_receipts.trip_id', 'trips.id')
      .leftJoin('vendor_bills', (join) =>
        join
          .onRef('vendor_bills.trip_id', '=', 'trips.id')
          .on('vendor_bills.vendor_id', '=', vendorId),
      )
      .select((eb) => [
        'trips.id as id',
        'trips.code as code',
        'trips.vehicle_no as vehicleRegistrationNo',
        'trips.vehicle_type as vehicleType',
        'trips.driver_name as driverName',
        'trips.stage as stage',
        'trips.delivered_at as deliveredAt',
        'trips.pod_status as podStatus',
        'trips.pod_received_at as podReceivedAt',
        'trips.pod_penalty as podPenaltyPaise',
        'trips.buy_rate as freightPaise',
        'trips.advance_paid as advancePaidPaise',
        'trips.balance_paid as balancePaidPaise',
        'indents.from_city as originCity',
        'indents.to_city as destinationCity',
        'indents.advance_pct as advancePct',
        'lorry_receipts.code as lrNo',
        'lorry_receipts.booked_at as lrBookedAt',
        'vendor_bills.id as billId',
        // The driver's own number, snapshotted onto the LR at booking. `trips`
        // has no phone column and `users` is revoked, so this is the only
        // reachable source — and it is the transporter's own driver.
        sql<string | null>`lorry_receipts.driver ->> 'phone'`.as('driverPhone'),
        // `BR-52`: a rejected POD must carry its reason, or it is re-sent
        // unchanged. Newest receipt wins — `supersedes_id` chains re-attachments.
        eb
          .selectFrom('pod_receipts')
          .select('pod_receipts.reject_reason')
          .whereRef('pod_receipts.trip_id', '=', 'trips.id')
          .orderBy('pod_receipts.created_at', 'desc')
          .limit(1)
          .as('podRejectionReason'),
        // `ATTACHED` is the one `trips.pod_status` value the PORTAL owns
        // (`20260814090100` §trips: "plus ATTACHED which the portal owns and
        // the console picks up at RECEIVED") — and `vendor_api` holds no
        // `update` on `trips` at all, only column-scoped `select`
        // (`20260814090200` §2). So the portal cannot write that transition and
        // derives it instead, from its own `pod_receipts` row: a receipt
        // carrying a courier docket IS the attachment. See
        // `PortalTripsService.toTrip`, which promotes `PENDING` to `ATTACHED`
        // on this column and leaves every later status alone.
        eb
          .selectFrom('pod_receipts')
          .select('pod_receipts.created_at')
          .whereRef('pod_receipts.trip_id', '=', 'trips.id')
          .where('pod_receipts.courier_docket', 'is not', null)
          .orderBy('pod_receipts.created_at', 'desc')
          .limit(1)
          .as('podAttachedAt'),
      ])
      .where('trips.vendor_id', '=', vendorId);
  }

  // ── Writes — 11-portal.md §5.4, §5.5 ────────────────────────────────────

  /**
   * The trip a POD or a bill is being written against, re-read INSIDE the
   * write transaction so the gate is checked against the row being written to
   * rather than one fetched before the transporter pressed send.
   *
   * Vendor-scoped like everything else here: another vendor's trip simply is
   * not returned, and the service turns that into `404` — never `403`, which
   * would confirm it exists (§2).
   */
  /** The same projection outside a transaction, for `GET /portal/trips/:id/bill`. */
  findOwnTrip(vendorId: string, idOrCode: string) {
    return this.findOwnTripForWrite(this.db, vendorId, idOrCode);
  }

  findOwnTripForWrite(db: DbExecutor, vendorId: string, idOrCode: string) {
    const query = db
      .selectFrom('trips')
      .leftJoin('vendor_bills', (join) =>
        join
          .onRef('vendor_bills.trip_id', '=', 'trips.id')
          .on('vendor_bills.vendor_id', '=', vendorId),
      )
      .select([
        'trips.id as id',
        'trips.code as code',
        'trips.stage as stage',
        'trips.delivered_at as deliveredAt',
        'trips.pod_status as podStatus',
        'trips.pod_received_at as podReceivedAt',
        'trips.pod_penalty as podPenaltyPaise',
        'trips.buy_rate as freightPaise',
        'trips.advance_paid as advancePaidPaise',
        'trips.balance_paid as balancePaidPaise',
        'vendor_bills.id as billId',
        'vendor_bills.bill_no as billNo',
        'vendor_bills.bill_date as billDate',
        'vendor_bills.status as billStatus',
        'vendor_bills.total as billTotalPaise',
        'vendor_bills.computed_balance as billComputedBalancePaise',
        'vendor_bills.variance as billVariancePaise',
        'vendor_bills.submitted_at as billSubmittedAt',
        'vendor_bills.attachment_id as billAttachmentId',
      ])
      .where('trips.vendor_id', '=', vendorId);

    return (UUID.test(idOrCode)
      ? query.where('trips.id', '=', idOrCode)
      : query.where('trips.code', '=', idOrCode)
    ).executeTakeFirst();
  }

  /** The newest receipt on a trip, to decide whether this one supersedes it (`BR-52`). */
  latestPodReceipt(db: DbExecutor, tripId: string) {
    return db
      .selectFrom('pod_receipts')
      .select(['id', 'courier_docket as courierDocket', 'created_at as createdAt'])
      .where('trip_id', '=', tripId)
      .orderBy('created_at', 'desc')
      .limit(1)
      .executeTakeFirst();
  }

  /**
   * `BR-51` — the docket and the sent-on date go in together, which the
   * `pod_attach_needs_docket` CHECK also enforces.
   *
   * **`received_on` is not in this statement and must never be.** `BR-49`: that
   * column, and `trips.pod_received_at` beside it, are the branch physically
   * receiving the paper copy. Attaching a photograph stops no clock, and a
   * transporter who is told it did stops chasing the courier. `received_by`,
   * `verified_*` and `approved_*` are absent for the same reason — every one of
   * them is a decision the desk makes about this document, not a fact the
   * sender may assert about it.
   */
  async insertPodReceipt(
    db: DbExecutor,
    row: {
      tripId: string;
      courierDocket: string;
      sentOn: string;
      note: string | null;
      pages: number;
      attachmentIds: string[];
      supersedesId: string | null;
    },
  ) {
    return db
      .insertInto('pod_receipts')
      .values({
        // See PORTAL_POD_CODE_PREFIX: `number_series` is revoked from this
        // pool and there is no portal sequence for PDR- codes, so the suffix is
        // random. Disjoint from the console's PDR-00001 on the shared unique
        // index, which is the property that matters.
        code: sql<string>`${PORTAL_POD_CODE_PREFIX} || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))`,
        trip_id: row.tripId,
        courier_docket: row.courierDocket,
        sent_on: row.sentOn,
        condition: row.note,
        pages: row.pages,
        attachment_ids: row.attachmentIds,
        supersedes_id: row.supersedesId,
      })
      .returning(['id', 'code', 'courier_docket as courierDocket', 'sent_on as sentOn', 'condition as note', 'pages', 'created_at as createdAt'])
      .executeTakeFirstOrThrow();
  }

  /** `unique (vendor_id, bill_no)` — within THIS vendor. Another vendor's is not a clash. */
  findBillByNo(db: DbExecutor, vendorId: string, billNo: string) {
    return db
      .selectFrom('vendor_bills')
      .select(['id', 'bill_no as billNo'])
      .where('vendor_id', '=', vendorId)
      .where('bill_no', '=', billNo)
      .executeTakeFirst();
  }

  /**
   * `BR-53`. `variance` is a generated column (`total - computed_balance`) and
   * is returned rather than computed here — the database owns the arithmetic,
   * so the number the desk sorts its queue by and the number the transporter is
   * shown cannot drift apart.
   *
   * `status` is left to its `SUBMITTED` default. A variance does NOT make it
   * `QUERIED`: `07-P6` §3 puts that decision with finance, and a bill this
   * endpoint marked queried by itself would be a refusal wearing a 201.
   */
  insertVendorBill(
    db: DbExecutor,
    row: {
      tripId: string;
      vendorId: string;
      billNo: string;
      billDate: string;
      attachmentId: string;
      freightPaise: number;
      chargesPaise: number;
      totalPaise: number;
      computedBalancePaise: number;
    },
  ) {
    return db
      .insertInto('vendor_bills')
      .values({
        trip_id: row.tripId,
        vendor_id: row.vendorId,
        bill_no: row.billNo,
        bill_date: row.billDate,
        attachment_id: row.attachmentId,
        freight: row.freightPaise,
        charges: row.chargesPaise,
        total: row.totalPaise,
        computed_balance: row.computedBalancePaise,
      })
      .returning([
        'id',
        'bill_no as billNo',
        'bill_date as billDate',
        'status',
        'total as totalPaise',
        'computed_balance as computedBalancePaise',
        'variance as variancePaise',
        'submitted_at as submittedAt',
      ])
      .executeTakeFirstOrThrow();
  }
}
