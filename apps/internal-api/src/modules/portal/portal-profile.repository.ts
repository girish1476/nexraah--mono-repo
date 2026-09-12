import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, PortalDb } from '../../db/kysely';

export interface PortalBusinessRow {
  trips: number;
  valuePaise: number;
  outstandingPaise: number;
}

/**
 * `08-P7` §1: "**Masked.** PAN and bank account last four only. Not
 * `GET /vendors/:id` with fields dropped."
 *
 * The row this repository returns still holds the unmasked `pan` and
 * `bank_account` — `vendors` carries a whole-table grant and there is no
 * column-level place to mask. The masking is therefore the service's job and
 * the DTO's, and neither raw value is ever put on a DTO field.
 */
@Injectable()
export class PortalProfileRepository {
  constructor(@Inject(DB) private readonly db: PortalDb) {}

  transaction() {
    return this.db.transaction();
  }

  /**
   * `BR-23` — a re-upload resets to `PENDING` and never carries a previous
   * `VERIFIED` forward. The old decision was about the old file, so keeping it
   * would let a rejected document be replaced by anything and stay approved.
   *
   * `vendor_kyc` has `unique (vendor_id, kind)`, so this is an upsert: a
   * transporter re-sending their PAN replaces the row rather than stacking a
   * second one the desk would have to reconcile.
   */
  upsertKyc(
    db: DbExecutor,
    row: { vendorId: string; kind: string; attachmentId: string },
  ) {
    return db
      .insertInto('vendor_kyc')
      .values({
        vendor_id: row.vendorId,
        kind: row.kind,
        route: 'MANUAL',
        status: 'PENDING',
        attachment_id: row.attachmentId,
      })
      .onConflict((oc) =>
        oc.columns(['vendor_id', 'kind']).doUpdateSet({
          attachment_id: row.attachmentId,
          status: 'PENDING',
          verified_by: null,
          verified_at: null,
          // A fresh photo makes the old rejection stale — see `reject_reason`
          // on this table and `getProfile`'s use of it.
          reject_reason: null,
          updated_at: sql`now()`,
        }),
      )
      .returning(['id', 'kind', 'status', 'updated_at as updatedAt'])
      .executeTakeFirstOrThrow();
  }

  /** Same reset rule as `upsertKyc`; `vendor_documents` has `unique (vendor_id, kind)`. */
  upsertDocument(
    db: DbExecutor,
    row: {
      vendorId: string;
      kind: string;
      attachmentId: string;
      reference: string | null;
      validFrom: string | null;
      validTo: string | null;
    },
  ) {
    return db
      .insertInto('vendor_documents')
      .values({
        vendor_id: row.vendorId,
        kind: row.kind,
        attachment_id: row.attachmentId,
        reference: row.reference,
        valid_from: row.validFrom,
        valid_to: row.validTo,
        status: 'PENDING',
      })
      .onConflict((oc) =>
        oc.columns(['vendor_id', 'kind']).doUpdateSet({
          attachment_id: row.attachmentId,
          reference: row.reference,
          valid_from: row.validFrom,
          valid_to: row.validTo,
          status: 'PENDING',
          verified_by: null,
          reject_reason: null,
          updated_at: sql`now()`,
        }),
      )
      .returning(['id', 'kind', 'status', 'updated_at as updatedAt'])
      .executeTakeFirstOrThrow();
  }

  findVendor(vendorId: string) {
    return this.db
      .selectFrom('vendors')
      .select([
        'id',
        'code',
        'legal_name as legalName',
        'base_city as baseCity',
        'gstin',
        'pan',
        'phone',
        'account_holder as accountHolder',
        'bank_account as bankAccount',
        'ifsc',
        'advance_pct as advancePct',
        'status',
      ])
      .where('id', '=', vendorId)
      .executeTakeFirst();
  }

  /** `BR-04`: `value_masked` is already the last four and the CHECK keeps it so. */
  findKyc(vendorId: string) {
    return this.db
      .selectFrom('vendor_kyc')
      .select([
        'kind',
        'value_masked as valueMasked',
        'status',
        'verified_at as decidedAt',
        'reject_reason as rejectReason',
      ])
      .where('vendor_id', '=', vendorId)
      .execute();
  }

  findDocuments(vendorId: string) {
    return this.db
      .selectFrom('vendor_documents')
      .select(['kind', 'status', 'valid_to as validTo', 'reject_reason as rejectReason'])
      .where('vendor_id', '=', vendorId)
      .execute();
  }

  /**
   * "Their business with us — trips, value, outstanding" (`08-P7` §1). Every
   * column here is theirs: `buy_rate` is the rate they quoted and won, and
   * `advance_paid`/`balance_paid` are what has reached their account.
   */
  async business(vendorId: string): Promise<PortalBusinessRow> {
    const result = await sql<PortalBusinessRow>`
      select
        count(*)::int as "trips",
        coalesce(sum(buy_rate), 0)::bigint as "valuePaise",
        coalesce(sum(greatest(buy_rate - advance_paid - balance_paid, 0)), 0)::bigint
          as "outstandingPaise"
      from trips
      where vendor_id = ${vendorId}
    `.execute(this.db);

    return result.rows[0] ?? { trips: 0, valuePaise: 0, outstandingPaise: 0 };
  }
}
