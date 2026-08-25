import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { DB } from '../../db/tokens';
import type { DbExecutor, PortalDb } from '../../db/kysely';

/**
 * `04-P3` §1: registration is unique **within vendor**, and the same truck can
 * legitimately sit on two panels when it is attached rather than owned. Two
 * transporters typing the same plate differently — `MH 15 GT 4482`,
 * `MH15GT4482`, `mh-15-gt-4482` — are still typing the same truck, so the
 * comparison is on this normal form while the row keeps what was typed.
 */
const NORMALISED_REGISTRATION = sql<string>`upper(regexp_replace(vendor_fleet.registration, '[^A-Za-z0-9]', '', 'g'))`;

export function normaliseRegistration(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * `vendor_fleet` is one of the four tables `vendor_api` holds outright
 * (`20260814090200` §2 — "Full access to what is theirs"), so there is no
 * column list to keep honest here. The `vendor_id` predicate still is: a table
 * grant is not a row filter.
 */
@Injectable()
export class PortalFleetRepository {
  constructor(@Inject(DB) private readonly db: PortalDb) {}

  list(vendorId: string, status?: string) {
    let query = this.db
      .selectFrom('vendor_fleet')
      .select([
        'id',
        'registration as registrationNo',
        'type as truckType',
        'capacity_kg as capacityKg',
        'current_city as currentCity',
        'status',
        'free_from as freeFrom',
      ])
      .where('vendor_id', '=', vendorId);

    if (status) query = query.where('status', '=', status);

    return query.orderBy('registration', 'asc').execute();
  }

  /**
   * `04-P3` §2: "A bare `DOCS_DUE` pill with no reason generates a support
   * call, and the transporter is the only person who can fix it." The earliest
   * lapse is the one that has to be fixed first, so it is the one named.
   */
  lapsedDocument(vendorId: string, today: string) {
    return this.db
      .selectFrom('vendor_documents')
      .select(['kind', 'valid_to as expiredOn'])
      .where('vendor_id', '=', vendorId)
      .where('valid_to', 'is not', null)
      .where('valid_to', '<', today)
      .orderBy('valid_to', 'asc')
      .executeTakeFirst();
  }

  // ── Writes — 11-portal.md §5.3 ──────────────────────────────────────────

  transaction() {
    return this.db.transaction();
  }

  /** One vehicle, theirs. `vendor_id` in the predicate, so a foreign id misses. */
  findOwnById(db: DbExecutor, vendorId: string, id: string) {
    return db
      .selectFrom('vendor_fleet')
      .select([
        'id',
        'registration as registrationNo',
        'type as truckType',
        'capacity_kg as capacityKg',
        'current_city as currentCity',
        'status',
        'free_from as freeFrom',
      ])
      .where('id', '=', id)
      .where('vendor_id', '=', vendorId)
      .executeTakeFirst();
  }

  /**
   * The within-vendor duplicate check behind `409 VEHICLE_DUPLICATE`. Scoped to
   * the caller's own fleet on purpose — a global probe would let one transporter
   * ask whether another has a given truck, which `04-P3` §1 calls `NFR-02`
   * leaking through an error message.
   *
   * `excludeId` is the `PATCH` case: a vehicle does not clash with itself.
   */
  findByRegistration(db: DbExecutor, vendorId: string, registration: string, excludeId?: string) {
    let query = db
      .selectFrom('vendor_fleet')
      .select(['id', 'registration as registrationNo'])
      .where('vendor_id', '=', vendorId)
      .where(NORMALISED_REGISTRATION, '=', normaliseRegistration(registration));

    if (excludeId) query = query.where('id', '<>', excludeId);
    return query.executeTakeFirst();
  }

  insertVehicle(
    db: DbExecutor,
    row: {
      vendorId: string;
      registration: string;
      type: string;
      capacityKg: number;
      currentCity: string | null;
      status: string;
      freeFrom: string | null;
    },
  ) {
    return db
      .insertInto('vendor_fleet')
      .values({
        vendor_id: row.vendorId,
        registration: row.registration,
        type: row.type,
        capacity_kg: row.capacityKg,
        current_city: row.currentCity,
        status: row.status,
        free_from: row.freeFrom,
      })
      .returning([
        'id',
        'registration as registrationNo',
        'type as truckType',
        'capacity_kg as capacityKg',
        'current_city as currentCity',
        'status',
        'free_from as freeFrom',
      ])
      .executeTakeFirstOrThrow();
  }

  /**
   * `vendor_id` is in the WHERE clause as well as the caller's already-checked
   * read: the check and the write are two statements, and only the predicate on
   * the write itself is proof against what happened in between.
   */
  updateVehicle(
    db: DbExecutor,
    vendorId: string,
    id: string,
    patch: {
      registration?: string;
      type?: string;
      capacity_kg?: number;
      current_city?: string | null;
      status?: string;
      free_from?: string | null;
    },
  ) {
    return db
      .updateTable('vendor_fleet')
      .set({ ...patch, updated_at: sql<string>`now()` })
      .where('id', '=', id)
      .where('vendor_id', '=', vendorId)
      .returning([
        'id',
        'registration as registrationNo',
        'type as truckType',
        'capacity_kg as capacityKg',
        'current_city as currentCity',
        'status',
        'free_from as freeFrom',
      ])
      .executeTakeFirst();
  }
}
