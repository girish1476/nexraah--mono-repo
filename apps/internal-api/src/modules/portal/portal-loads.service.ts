import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { portalError } from './portal.errors';
import { PORTAL_ENDPOINT } from './portal.constants';
import { PortalLoadsRepository } from './portal-loads.repository';
import { PortalFleetRepository } from './portal-fleet.repository';
import { PortalIdempotencyRepository, runIdempotentWrite } from './portal-idempotency.repository';
import {
  PortalLoadDto,
  PortalQuoteCreatedDto,
  PortalQuoteDto,
  PortalQuoteWithdrawnDto,
  expose,
  exposeAll,
} from './portal.dto';
import type { SubmitQuoteDto } from './portal-write.dto';
import { PortalWriteResult, type PortalVendor } from './portal.types';

/**
 * `03-P2` §2 / `04-P3` §2: own fleet, `AVAILABLE` only. Deliberately does not
 * name the trip the truck is on, and says the same sentence for DOCS_DUE,
 * ON_TRIP and MAINTENANCE alike.
 */
function assertAvailable(status: string): void {
  if (status !== 'AVAILABLE') {
    throw portalError('VEHICLE_UNAVAILABLE', 'That vehicle is not available right now. Free one up under Fleet.');
  }
}

const REPORTING_TEXT: Record<string, string> = {
  SAME_DAY: 'Reports same day',
  NEXT_DAY: 'Reports next day',
  SCHEDULED: 'Reports on a scheduled date',
};

/**
 * `quotes` has one free-text column and the Ops desk reads it on the quote
 * row. The driver's mobile and the reporting offer are the two things the
 * form collects that have nowhere else to land, so they are folded into it
 * — in words, not codes, because the person reading it is placing a truck,
 * not decoding an enum.
 */
function quoteRemarks(dto: SubmitQuoteDto): string | null {
  const parts: string[] = [];
  const typed = dto.remarks?.trim();
  if (typed) parts.push(typed);
  if (dto.driverMobile) parts.push(`Driver ${dto.driverMobile}`);
  if (dto.reportingRule) {
    const when =
      dto.reportingRule === 'SCHEDULED' && dto.scheduledDate
        ? `Reports on ${dto.scheduledDate}`
        : REPORTING_TEXT[dto.reportingRule];
    if (when) parts.push(when);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** The row shape `PortalLoadsRepository.baseLoadQuery` returns. */
interface LoadRow {
  code: string;
  originCity: string;
  destinationCity: string;
  truckType: string;
  weightKg: number;
  material: string;
  transitDays: number | null;
  reportingRule: string | null;
  remarks: string | null;
  pickupDate: string;
  bidMinPaise: number | null;
  bidMaxPaise: number | null;
  advancePct: number;
  myQuoteId: string | null;
  myQuoteAmountPaise: number | null;
  myQuoteBandPosition: string | null;
}

/**
 * `11-portal.md` §5.2: "**Not** `GET /indents` with fields removed — a separate
 * handler, a separate DTO, a separate pool."
 */
@Injectable()
export class PortalLoadsService {
  constructor(
    private readonly repository: PortalLoadsRepository,
    private readonly fleetRepository: PortalFleetRepository,
    private readonly idempotency: PortalIdempotencyRepository,
    private readonly auditService: AuditService,
  ) {}

  async listLoads(
    vendor: PortalVendor,
    filters: { truckType?: string; branch?: string },
  ): Promise<PortalLoadDto[]> {
    const fleetTypes = await this.repository.fleetTruckTypes(vendor.vendorId);
    // `04-P3` §1: "a stale fleet is the commonest reason a transporter sees an
    // empty list". A vendor with no fleet row matches no load, and the screen's
    // empty copy points them at Fleet. Short-circuited rather than queried
    // because `in ()` is a Postgres syntax error, not an empty result.
    if (fleetTypes.length === 0) return [];

    const rows = await this.repository.listOpen(vendor.vendorId, fleetTypes, {
      truckTypes: splitCsv(filters.truckType),
      branchId: filters.branch,
    });
    return exposeAll(
      PortalLoadDto,
      rows.map((row) => this.toLoad(row as LoadRow)),
    );
  }

  async getLoad(vendor: PortalVendor, code: string): Promise<PortalLoadDto> {
    const fleetTypes = await this.repository.fleetTruckTypes(vendor.vendorId);
    const row = fleetTypes.length
      ? await this.repository.findOpenByCode(vendor.vendorId, code, fleetTypes)
      : undefined;

    // 404 for "unknown", "already awarded" and "not offered to you" alike.
    // `11-portal.md` §2: a 403 confirms existence, and vendor A probing a code
    // range would learn which lanes vendor B is being offered.
    if (!row) throw portalError('NOT_FOUND', 'That load is no longer available.');

    return expose(PortalLoadDto, this.toLoad(row as LoadRow));
  }

  async listQuotes(vendor: PortalVendor, status?: string): Promise<PortalQuoteDto[]> {
    const wanted = splitCsv(status);
    const rows = await this.repository.listQuotes(vendor.vendorId);

    const mapped = rows.map((row) => {
      const portalStatus = quoteStatus(row.status, row.bandPosition);
      return {
        id: row.id,
        loadCode: row.loadCode,
        originCity: row.originCity,
        destinationCity: row.destinationCity,
        amountPaise: row.amountPaise,
        status: portalStatus,
        submittedAt: row.submittedAt,
        // Only while the desk has not decided, and only ever their own
        // overshoot against a ceiling already printed on the load card.
        aboveBandByPaise:
          portalStatus === 'PENDING_APPROVAL' && row.bidMaxPaise !== null
            ? Math.max(0, row.amountPaise - row.bidMaxPaise)
            : null,
        tripId: portalStatus === 'WON' ? (row.tripCode ?? null) : null,
        lostReason: lostReason(portalStatus, row.indentStage),
      };
    });

    const filtered = wanted?.length ? mapped.filter((q) => wanted.includes(q.status)) : mapped;
    return exposeAll(PortalQuoteDto, filtered);
  }

  // ── Writes — 11-portal.md §5.2 ──────────────────────────────────────────

  /**
   * `POST /portal/loads/:code/quote`. `BR-05` / `D-39`, in the order the errors
   * have to be decided in:
   *
   * 1. a replay of the same `Idempotency-Key` returns the ORIGINAL quote, `200`;
   * 2. a code this vendor's fleet cannot serve is `404` — the same predicate the
   *    list and the detail read use, so a load that would not show cannot be
   *    quoted on either;
   * 3. an indent that has moved off `OPEN`, or already carries a vendor, is
   *    `409 LOAD_CLOSED` — the transporter had it on screen and the desk awarded
   *    it while they typed;
   * 4. below `bid_min` is `422 BELOW_BAND` and **nothing is persisted**;
   * 5. above `bid_max` is ACCEPTED, stored `ABOVE_BAND`, and reported as
   *    `PENDING_APPROVAL`.
   *
   * On (5), `11-portal.md` §5.2 reads "Above band → `202` approval". The
   * approval row cannot be raised from here: `approvals` is in `vendor_api`'s
   * blanket `REVOKE ALL` and `ApprovalsService` is fed by `internalPool`, so
   * importing it would rebind `DB` and void layer one of the redaction contract
   * (`portal.module.ts`). The quote is therefore persisted `ABOVE_BAND` and the
   * approval is raised by the console at award time — `indents.service.ts`
   * already does exactly that, keyed off the same `band_position`. What the
   * transporter sees is what `FE.md` §71 specifies either way: `201` with
   * `status: "PENDING_APPROVAL"`.
   */
  async submitQuote(
    vendor: PortalVendor,
    code: string,
    dto: SubmitQuoteDto,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<PortalWriteResult<PortalQuoteCreatedDto>> {
    return runIdempotentWrite(
      {
        idempotency: this.idempotency,
        vendorId: vendor.vendorId,
        endpoint: PORTAL_ENDPOINT.QUOTE_CREATE,
        key: idempotencyKey,
        dto: PortalQuoteCreatedDto,
      },
      () => this.doSubmitQuote(vendor, code, dto, idempotencyKey, requestId),
    );
  }

  private async doSubmitQuote(
    vendor: PortalVendor,
    code: string,
    dto: SubmitQuoteDto,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<PortalWriteResult<PortalQuoteCreatedDto>> {
    const endpoint = PORTAL_ENDPOINT.QUOTE_CREATE;
    const indent = await this.repository.findIndentByCode(code);
    const fleetTypes = await this.repository.fleetTruckTypes(vendor.vendorId);
    const serviceable = fleetTypes.map((t) => t.trim().toLowerCase());

    // 404 for "unknown" and "not offered to you" alike. A 403 confirms
    // existence, and vendor A probing a code range would learn which lanes
    // vendor B is being offered (`11-portal.md` §2).
    if (!indent || !serviceable.includes(indent.truckType.trim().toLowerCase())) {
      throw portalError('NOT_FOUND', 'That load is no longer available.');
    }

    if (indent.stage !== 'OPEN' || indent.awardedVendorId !== null) {
      // Says the load is gone and nothing else — not who took it, not for how
      // much, not how many others quoted (`BR-55`).
      throw portalError('LOAD_CLOSED', 'This load is no longer accepting quotes.');
    }

    // BR-05, before anything is written. `details.bidMin` is the one detail the
    // filter's allow-list lets through, and it is a number already printed on
    // the load card as `bandLowPaise`.
    if (indent.bidMinPaise !== null && dto.amountPaise < indent.bidMinPaise) {
      throw portalError(
        'BELOW_BAND',
        `Nexraah will not award this lane below ₹${formatPaise(indent.bidMinPaise)} — ` +
          'it would run at a loss for you and for the desk.',
        { bidMin: indent.bidMinPaise },
      );
    }

    const bandPosition =
      indent.bidMaxPaise !== null && dto.amountPaise > indent.bidMaxPaise
        ? 'ABOVE_BAND'
        : 'IN_BAND';

    return this.repository.transaction().execute(async (trx) => {
      // `03-P2` §2 / `04-P3` §2: own fleet, `AVAILABLE` only. The quote form
      // already filters the selector; this is the same rule on the server,
      // which is the one that counts (`NFR-01`). A foreign vehicle id is 404.
      let truckRegistration: string | null = null;
      if (dto.vehicleId) {
        const vehicle = await this.fleetRepository.findOwnById(trx, vendor.vendorId, dto.vehicleId);
        if (!vehicle) throw portalError('NOT_FOUND', 'That vehicle is not in your fleet.');
        assertAvailable(vehicle.status);
        truckRegistration = vehicle.registrationNo;
      } else if (dto.vehicleRegistrationNo) {
        // The form's path: a plate, typed or picked. When it is one of theirs
        // the same availability rule applies as for an id — a plate is not a
        // way round a DOCS_DUE truck. When it is not, it is kept as typed:
        // the quote form says in so many words that a truck outside Fleet may
        // still be offered.
        const typed = dto.vehicleRegistrationNo.trim().toUpperCase();
        const own = await this.fleetRepository.findByRegistration(trx, vendor.vendorId, typed);
        if (own) {
          const vehicle = await this.fleetRepository.findOwnById(trx, vendor.vendorId, own.id);
          if (vehicle) assertAvailable(vehicle.status);
          truckRegistration = own.registrationNo;
        } else {
          truckRegistration = typed;
        }
      }

      // `quotes` is `unique (indent_id, vendor_id)`. Checked here rather than
      // caught as a duplicate-key error so the transporter gets the code the
      // screen branches on. A WITHDRAWN row still occupies the pair — see the
      // note on `withdrawQuote`.
      const existing = await this.repository.findQuoteForIndent(trx, vendor.vendorId, indent.id);
      if (existing) {
        throw portalError('QUOTE_EXISTS', 'You have already quoted on this load.');
      }

      const inserted = await this.repository.insertQuote(trx, {
        indentId: indent.id,
        vendorId: vendor.vendorId,
        amountPaise: dto.amountPaise,
        truckRegistration,
        remarks: quoteRemarks(dto),
        bandPosition,
      });

      const payload = {
        id: inserted.id,
        loadCode: indent.code,
        amountPaise: inserted.amountPaise,
        status: quoteStatus('SUBMITTED', bandPosition),
        aboveBand: bandPosition === 'ABOVE_BAND',
      };

      // ADR-02 §7: portal writes now happen in a process that can audit them.
      // Same transaction as the insert (NFR-03).
      await this.auditService.recordPortalEvent(trx, vendor.vendorId, {
        action: 'PORTAL_QUOTE_SUBMITTED',
        entityType: 'quotes',
        entityId: inserted.id,
        after: {
          amountPaise: inserted.amountPaise,
          bandPosition,
          indentCode: indent.code,
        },
        requestId,
      });

      await this.idempotency.record(trx, vendor.vendorId, endpoint, idempotencyKey, payload);
      return new PortalWriteResult(expose(PortalQuoteCreatedDto, payload), false);
    });
  }

  /**
   * `DELETE /portal/quotes/:id` — `204`, and `409 QUOTE_NOT_WITHDRAWABLE` once
   * it is awarded, lost or already withdrawn (`FE.md` §130).
   *
   * A withdrawal is `UPDATE quotes SET status` and never a `DELETE`:
   * `vendor_api` holds `update (status)` on that table and nothing wider, so a
   * withdrawal cannot become a price edit after the band check has passed
   * (`20260814090200` §2).
   *
   * KNOWN LIMITATION, flagged rather than hidden: `quotes` is
   * `unique (indent_id, vendor_id)` and a withdrawn row keeps that pair, so a
   * vendor who withdraws cannot quote again on the same load — the second
   * attempt is `409 QUOTE_EXISTS`. Fixing it means either a partial unique
   * index (a migration) or an `UPDATE(amount, band_position)` grant, which
   * would reopen exactly the price-edit hole the column-scoped grant closes.
   * Neither is this module's to decide.
   */
  async withdrawQuote(
    vendor: PortalVendor,
    quoteId: string,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<PortalWriteResult<PortalQuoteWithdrawnDto>> {
    const endpoint = PORTAL_ENDPOINT.QUOTE_WITHDRAW;
    return runIdempotentWrite(
      {
        idempotency: this.idempotency,
        vendorId: vendor.vendorId,
        endpoint,
        key: idempotencyKey,
        dto: PortalQuoteWithdrawnDto,
      },
      () =>
        this.repository.transaction().execute(async (trx) => {
          const quote = await this.repository.findOwnQuoteById(trx, vendor.vendorId, quoteId);
          // Another vendor's quote id is 404, never 403 — a 403 would confirm the
          // quote exists, and an id range is cheap to walk.
          if (!quote) throw portalError('NOT_FOUND', 'That quote is no longer available.');

          if (quote.status !== 'SUBMITTED') {
            // No reason, and above all no winning amount: `03-P2` §3 — a decided
            // quote never says why.
            throw portalError('QUOTE_NOT_WITHDRAWABLE', 'This quote can no longer be withdrawn.');
          }

          const withdrawn = await this.repository.withdrawQuote(trx, vendor.vendorId, quoteId);
          if (!withdrawn) {
            throw portalError('QUOTE_NOT_WITHDRAWABLE', 'This quote can no longer be withdrawn.');
          }

          const payload = { id: quoteId, status: 'WITHDRAWN' };

          await this.auditService.recordPortalEvent(trx, vendor.vendorId, {
            action: 'PORTAL_QUOTE_WITHDRAWN',
            entityType: 'quotes',
            entityId: quoteId,
            before: { status: quote.status },
            after: { status: 'WITHDRAWN' },
            requestId,
          });

          await this.idempotency.record(trx, vendor.vendorId, endpoint, idempotencyKey, payload);
          return new PortalWriteResult(expose(PortalQuoteWithdrawnDto, payload), false);
        }),
    );
  }

  private toLoad(row: LoadRow) {
    return {
      code: row.code,
      originCity: row.originCity,
      destinationCity: row.destinationCity,
      truckType: row.truckType,
      weightKg: row.weightKg,
      goods: row.material,
      // No lane distance is reachable from this pool: `indents` carries none
      // and `rate_card_lanes` is in `vendor_api`'s blanket REVOKE. Null rather
      // than a guess — a wrong distance on a freight screen is worse than none.
      distanceKm: null,
      transitDays: row.transitDays,
      reportingRule: row.reportingRule,
      remarks: row.remarks,
      // `indents.pickup_date` is a DATE. `00-conventions.md` §5 puts date-only
      // fields on the wire as bare `YYYY-MM-DD`, which is what pg's type
      // parser (db/pools.ts) already hands back.
      pickupAt: row.pickupDate,
      bandLowPaise: row.bidMinPaise,
      bandHighPaise: row.bidMaxPaise,
      advancePct: row.advancePct,
      myQuote: row.myQuoteId
        ? {
            id: row.myQuoteId,
            status: quoteStatus('SUBMITTED', row.myQuoteBandPosition),
            amountPaise: row.myQuoteAmountPaise,
          }
        : null,
    };
  }
}

/**
 * `quotes.status` is the console's four-value enum; the transporter's is
 * `FE.md` §2's five. `ACCEPTED` reads as `WON` and `REJECTED` as `LOST` because
 * those are the transporter's words for the same fact — and an above-band quote
 * is `PENDING_APPROVAL` rather than `SUBMITTED` so the screen can say the desk
 * has not decided yet (`D-39`).
 */
function quoteStatus(status: string, bandPosition: string | null): string {
  if (status === 'ACCEPTED') return 'WON';
  if (status === 'REJECTED') return 'LOST';
  if (status === 'WITHDRAWN') return 'WITHDRAWN';
  return bandPosition === 'ABOVE_BAND' ? 'PENDING_APPROVAL' : 'SUBMITTED';
}

/**
 * `03-P2` §3: "Rejected never says why." The enum is deliberately coarse — it
 * says the load is gone, which the list already showed, and nothing about who
 * took it or for how much.
 */
function lostReason(portalStatus: string, indentStage: string): string | null {
  if (portalStatus !== 'LOST') return null;
  return indentStage === 'OPEN' ? 'EXPIRED' : 'AWARDED_ELSEWHERE';
}

/**
 * `BELOW_BAND`'s sentence names the floor in rupees, because the transporter is
 * looking at that same number on the load card as `bandLowPaise`. It is the only
 * money any portal error message may carry — never a rival's amount, never the
 * ceiling, never a count.
 */
function formatPaise(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function splitCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}
