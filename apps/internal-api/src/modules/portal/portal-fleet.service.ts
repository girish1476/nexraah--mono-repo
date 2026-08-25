import { Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import {
  CALLER_SETTABLE_FLEET_STATUSES,
  DOCUMENT_LABEL,
  FLEET_STATUSES,
  PORTAL_ENDPOINT,
} from './portal.constants';
import { portalError } from './portal.errors';
import { PortalFleetRepository } from './portal-fleet.repository';
import { PortalIdempotencyRepository, runIdempotentWrite } from './portal-idempotency.repository';
import { PortalFleetVehicleDto, expose, exposeAll } from './portal.dto';
import type { AddVehicleDto, UpdateVehicleDto } from './portal-write.dto';
import { PortalWriteResult, type PortalVendor } from './portal.types';

@Injectable()
export class PortalFleetService {
  private readonly logger = new Logger('PortalFleetService');

  constructor(
    private readonly repository: PortalFleetRepository,
    private readonly idempotency: PortalIdempotencyRepository,
    private readonly auditService: AuditService,
  ) {}

  /**
   * `FE.md` §4: optional `availability=AVAILABLE`, used by the quote form's
   * vehicle selector — the same list, narrowed, rather than a second endpoint
   * that could drift from this one.
   */
  async listFleet(vendor: PortalVendor, availability?: string): Promise<PortalFleetVehicleDto[]> {
    const status = (FLEET_STATUSES as readonly string[]).includes(availability ?? '')
      ? availability
      : undefined;

    const rows = await this.repository.list(vendor.vendorId, status);
    const needsReason = rows.some((v) => v.status === 'DOCS_DUE');
    const lapsed = needsReason
      ? await this.repository.lapsedDocument(vendor.vendorId, new Date().toISOString().slice(0, 10))
      : undefined;

    return exposeAll(
      PortalFleetVehicleDto,
      rows.map((row) => ({
        id: row.id,
        registrationNo: row.registrationNo,
        truckType: row.truckType,
        capacityKg: row.capacityKg,
        currentCity: row.currentCity,
        status: row.status,
        freeFrom: row.freeFrom,
        // `vendor_documents` has no vehicle column — the schema files documents
        // per VENDOR, not per truck — and its `kind` CHECK carries no FITNESS,
        // INSURANCE or PUC, which are three of the four `04-P3` §2 names as the
        // causes. So this names the vendor's earliest lapse rather than the
        // one that grounded this particular vehicle, and is null when none has
        // lapsed. Closing the gap properly is a schema change, not a query.
        docsDue:
          row.status === 'DOCS_DUE' && lapsed
            ? {
                documentKind: lapsed.kind,
                documentLabel: DOCUMENT_LABEL[lapsed.kind] ?? lapsed.kind,
                expiredOn: lapsed.expiredOn,
              }
            : null,
      })),
    );
  }

  // ── Writes — 11-portal.md §5.3 ──────────────────────────────────────────

  /**
   * `POST /portal/fleet`. `409 VEHICLE_DUPLICATE` on a clash **within this
   * vendor's own fleet** — `04-P3` §1: "the same registration under another
   * vendor → `201`", because the same truck legitimately appears on two panels
   * when it is attached rather than owned, and a global check would let one
   * transporter probe whether another holds a given plate.
   */
  async addVehicle(
    vendor: PortalVendor,
    dto: AddVehicleDto,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<PortalWriteResult<PortalFleetVehicleDto>> {
    const endpoint = PORTAL_ENDPOINT.FLEET_CREATE;
    const status = dto.status ?? 'AVAILABLE';

    return runIdempotentWrite(
      {
        idempotency: this.idempotency,
        vendorId: vendor.vendorId,
        endpoint,
        key: idempotencyKey,
        dto: PortalFleetVehicleDto,
      },
      () =>
        this.repository.transaction().execute(async (trx) => {
          // Inside the envelope, never before it: a replay must return the
          // original row without re-validating, or a retry whose body drifted
          // would fail where the first attempt succeeded.
          this.assertSettableStatus(status);
          this.assertFreeFrom(status, dto.freeFrom ?? null);

          const clash = await this.repository.findByRegistration(
            trx,
            vendor.vendorId,
            dto.registrationNo,
          );
          if (clash) {
            throw portalError('VEHICLE_DUPLICATE', 'That vehicle is already in your fleet.');
          }

          const row = await this.insertOrTranslate(trx, {
            vendorId: vendor.vendorId,
            registration: dto.registrationNo.trim(),
            type: dto.truckType.trim(),
            capacityKg: dto.capacityKg,
            currentCity: dto.currentCity?.trim() || null,
            status,
            freeFrom: dto.freeFrom ?? null,
          });

          const payload = { ...row, docsDue: null };

          await this.auditService.recordPortalEvent(trx, vendor.vendorId, {
            action: 'PORTAL_VEHICLE_ADDED',
            entityType: 'vendor_fleet',
            entityId: row.id,
            after: payload,
            requestId,
          });

          await this.idempotency.record(trx, vendor.vendorId, endpoint, idempotencyKey, payload);
          return new PortalWriteResult(expose(PortalFleetVehicleDto, payload), false);
        }),
    );
  }

  /**
   * `PATCH /portal/fleet/:id`. Partial: an absent field is left alone, and
   * `freeFrom: null` clears the date.
   *
   * The two refusals this endpoint exists to make (`04-P3` §4):
   * `DOCS_DUE` cannot be SET by the caller, and a system-set `DOCS_DUE` cannot
   * be CLEARED by them either — it is derived from document verification state
   * and only a re-upload lifts it. Both are `422 DOCS_DUE_NOT_SETTABLE`, and
   * both are refusals rather than silent drops: "A request naming it is
   * rejected, not ignored" (`11-portal.md` §5.3).
   */
  async updateVehicle(
    vendor: PortalVendor,
    id: string,
    dto: UpdateVehicleDto,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<PortalWriteResult<PortalFleetVehicleDto>> {
    const endpoint = PORTAL_ENDPOINT.FLEET_UPDATE;

    return runIdempotentWrite(
      {
        idempotency: this.idempotency,
        vendorId: vendor.vendorId,
        endpoint,
        key: idempotencyKey,
        dto: PortalFleetVehicleDto,
      },
      () =>
        this.repository.transaction().execute(async (trx) => {
          if (dto.status !== undefined) this.assertSettableStatus(dto.status);

          const current = await this.repository.findOwnById(trx, vendor.vendorId, id);
          // Another vendor's vehicle id is 404, never 403 (`11-portal.md` §2).
          if (!current) throw portalError('NOT_FOUND', 'That vehicle is not in your fleet.');

          // Not clearable. Refused even when the new status is a legal one — the
          // whole point of the state is that the transporter's route out of it is
          // Profile, not Fleet.
          if (current.status === 'DOCS_DUE' && dto.status !== undefined) {
            throw portalError(
              'DOCS_DUE_NOT_SETTABLE',
              'This vehicle is held for lapsed documents. Re-upload the document in Profile to make it available again.',
            );
          }

          const status = dto.status ?? current.status;
          const freeFrom = dto.freeFrom !== undefined ? dto.freeFrom : current.freeFrom;
          this.assertFreeFrom(status, freeFrom);

          if (dto.registrationNo !== undefined) {
            const clash = await this.repository.findByRegistration(
              trx,
              vendor.vendorId,
              dto.registrationNo,
              id,
            );
            if (clash) {
              throw portalError('VEHICLE_DUPLICATE', 'That vehicle is already in your fleet.');
            }
          }

          const row =
            (await this.updateOrTranslate(trx, vendor.vendorId, id, {
              ...(dto.registrationNo !== undefined && {
                registration: dto.registrationNo.trim(),
              }),
              ...(dto.truckType !== undefined && {
                type: dto.truckType.trim(),
              }),
              ...(dto.capacityKg !== undefined && {
                capacity_kg: dto.capacityKg,
              }),
              ...(dto.currentCity !== undefined && {
                current_city: dto.currentCity?.trim() || null,
              }),
              ...(dto.status !== undefined && { status: dto.status }),
              ...(dto.freeFrom !== undefined && { free_from: dto.freeFrom }),
            })) ?? current;

          // Same derivation as the list read, for the one case that survives a
          // PATCH: a DOCS_DUE vehicle whose other fields were edited. A bare
          // DOCS_DUE pill with no reason generates a support call (`04-P3` §2).
          const lapsed =
            row.status === 'DOCS_DUE'
              ? await this.repository.lapsedDocument(
                  vendor.vendorId,
                  new Date().toISOString().slice(0, 10),
                )
              : undefined;

          const payload = {
            ...row,
            docsDue: lapsed
              ? {
                  documentKind: lapsed.kind,
                  documentLabel: DOCUMENT_LABEL[lapsed.kind] ?? lapsed.kind,
                  expiredOn: lapsed.expiredOn,
                }
              : null,
          };

          await this.auditService.recordPortalEvent(trx, vendor.vendorId, {
            action: 'PORTAL_VEHICLE_UPDATED',
            entityType: 'vendor_fleet',
            entityId: id,
            before: current,
            after: row,
            requestId,
          });

          await this.idempotency.record(trx, vendor.vendorId, endpoint, idempotencyKey, payload);
          return new PortalWriteResult(expose(PortalFleetVehicleDto, payload), false);
        }),
    );
  }

  /** `DOCS_DUE` is derived, never asked for. `CALLER_SETTABLE_FLEET_STATUSES`. */
  private assertSettableStatus(status: string): void {
    if (!(CALLER_SETTABLE_FLEET_STATUSES as readonly string[]).includes(status)) {
      throw portalError(
        'DOCS_DUE_NOT_SETTABLE',
        'Docs due is set by Nexraah when a document lapses, and cleared when you re-upload it.',
      );
    }
  }

  /** `FE.md` §312 / `04-P3` §1: `ON_TRIP` without `freeFrom` → 422. */
  private assertFreeFrom(status: string, freeFrom: string | null): void {
    if (status === 'ON_TRIP' && !freeFrom) {
      throw portalError('FREE_FROM_REQUIRED', 'Tell us the date this truck frees up.');
    }
  }

  /**
   * KNOWN LIMITATION, flagged rather than hidden: `vendor_fleet.registration`
   * carries a GLOBAL `unique` in `20260814090100_c1_schema.sql`, while `04-P3`
   * §1 requires uniqueness **within vendor**. The within-vendor check above is
   * the one the transporter is answered from; if the global index still fires,
   * the plate belongs to ANOTHER vendor, and saying so — as `VEHICLE_DUPLICATE`
   * would — is precisely the `NFR-02` leak that section is about. So it becomes
   * a flat `REQUEST_FAILED` and a log line for the desk. The real fix is a
   * migration swapping the global index for `unique (vendor_id, registration)`,
   * which is `supabase/`'s to make, not this module's.
   */
  private async insertOrTranslate(
    ...args: Parameters<PortalFleetRepository['insertVehicle']>
  ): ReturnType<PortalFleetRepository['insertVehicle']> {
    try {
      return await this.repository.insertVehicle(...args);
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.warn(
          'vendor_fleet.registration global unique index rejected a portal insert that passed the within-vendor check — see 04-P3 §1',
        );
        throw portalError('REQUEST_FAILED');
      }
      throw error;
    }
  }

  private async updateOrTranslate(
    ...args: Parameters<PortalFleetRepository['updateVehicle']>
  ): ReturnType<PortalFleetRepository['updateVehicle']> {
    try {
      return await this.repository.updateVehicle(...args);
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.warn(
          'vendor_fleet.registration global unique index rejected a portal update that passed the within-vendor check — see 04-P3 §1',
        );
        throw portalError('REQUEST_FAILED');
      }
      throw error;
    }
  }
}

/** pg `unique_violation`. Never echoed — the constraint name would carry the table. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: unknown }).code === '23505'
  );
}
