import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { InternalDb } from '../../db/kysely';

@Injectable()
export class ComplianceRepository {
  constructor(@Inject(DB) private readonly db: InternalDb) {}

  /** Vendor files awaiting compliance — `status = PENDING_VERIFICATION`. */
  pendingVendorFiles() {
    return this.db
      .selectFrom('vendors')
      .select([
        'vendors.id as id',
        'vendors.code as code',
        'vendors.legal_name as legalName',
        'vendors.party_type as partyType',
        'vendors.created_at as createdAt',
      ])
      .where('vendors.status', '=', 'PENDING_VERIFICATION')
      .orderBy('vendors.created_at')
      .execute();
  }

  /** Every identity check and document on file for these vendors, with its status. */
  async papersFor(vendorIds: string[]) {
    if (!vendorIds.length) return { kyc: [], documents: [] };
    const [kyc, documents] = await Promise.all([
      this.db.selectFrom('vendor_kyc').select(['vendor_id as vendorId', 'kind', 'status']).where('vendor_id', 'in', vendorIds).execute(),
      this.db.selectFrom('vendor_documents').select(['vendor_id as vendorId', 'kind', 'status']).where('vendor_id', 'in', vendorIds).execute(),
    ]);
    return { kyc, documents };
  }

  /** Active/contracted clients whose agreement has no priced lanes yet. */
  clientsWithoutRateCards() {
    return this.db
      .selectFrom('clients')
      .leftJoin('rate_card_lanes', 'rate_card_lanes.client_id', 'clients.id')
      .select((eb) => [
        'clients.id as id',
        'clients.code as code',
        'clients.name as name',
        'clients.valid_to as validTo',
        'clients.created_at as createdAt',
        eb.fn.count<number>('rate_card_lanes.id').as('laneCount'),
      ])
      .where('clients.status', '=', 'ACTIVE')
      .where('clients.engagement', '=', 'CONTRACT')
      .groupBy(['clients.id'])
      .having((eb) => eb.fn.count('rate_card_lanes.id'), '=', 0)
      .execute();
  }

  /** Trip documents awaiting verification, grouped by trip. */
  pendingTripDocuments() {
    return this.db
      .selectFrom('trip_documents')
      .innerJoin('trips', 'trips.id', 'trip_documents.trip_id')
      .select((eb) => [
        'trips.id as tripId',
        'trips.code as tripCode',
        'trips.lane as lane',
        eb.fn.count<number>('trip_documents.id').as('pendingCount'),
        eb.fn.min<string>('trip_documents.created_at').as('oldestAt'),
      ])
      .where('trip_documents.status', '=', 'PENDING')
      .groupBy(['trips.id'])
      .orderBy(sql`min(trip_documents.created_at)`)
      .execute();
  }
}
