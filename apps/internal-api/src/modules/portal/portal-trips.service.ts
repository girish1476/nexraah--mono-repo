import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { portalError } from './portal.errors';
import {
  POD_FORFEIT_DAYS,
  POD_PENALTY_PER_DAY_PAISE,
  POD_TAT_DAYS,
  PORTAL_ENDPOINT,
} from './portal.constants';
import { PortalTripsRepository } from './portal-trips.repository';
import { PortalAttachmentsRepository } from './portal-attachments.repository';
import { PortalIdentityRepository } from './portal-identity.repository';
import { PortalIdempotencyRepository, runIdempotentWrite } from './portal-idempotency.repository';
import {
  PortalStorageService,
  type PortalStoredFile,
  type PortalUploadFile,
} from './portal-storage.service';
import {
  PortalBillChecklistDto,
  PortalLorryReceiptDto,
  PortalPodReceiptDto,
  PortalTripDto,
  PortalVendorBillDto,
  expose,
  exposeAll,
} from './portal.dto';
import type { AttachPodDto, SubmitBillDto } from './portal-write.dto';
import { PortalWriteResult, type PortalVendor } from './portal.types';

/**
 * `07-P6` §2: "It sits on the form, not in help text. A transporter who adds
 * 18% GST to a bill we cannot claim creates a reconciliation problem that
 * finance resolves by phone, one bill at a time."
 */
const REVERSE_CHARGE_DECLARATION =
  'TAX PAYABLE UNDER REVERSE CHARGE — do not add GST to this bill. ' +
  'Nexraah accounts for the tax under the reverse charge mechanism.';

/**
 * `11-portal.md` §5.4 / `BR-49`. Said on every POD response, because the whole
 * failure mode is a transporter who reads "uploaded" as "delivered to us" and
 * stops chasing the courier while the penalty accrues.
 */
const POD_ATTACH_NOTICE =
  'Attached. The penalty clock keeps running until your branch receives the paper copy — ' +
  'please make sure the original reaches them.';

/**
 * `07-P6` §3 — "Naming the difference immediately is what stops the follow-up
 * call." A variance is stated as a fact with its direction and what happens
 * next, never as an accusation: the transporter may well be right, and this
 * endpoint is not the place that decides.
 */
function varianceMessage(variancePaise: number): string {
  if (variancePaise === 0) {
    return 'Received. Your bill matches the balance we calculated, so nothing is holding it up.';
  }
  const rupees = Math.abs(variancePaise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return variancePaise > 0
    ? `Received. Your bill is ₹${rupees} more than the balance we calculated, so our team will check it against the trip before paying. You do not need to do anything.`
    : `Received. Your bill is ₹${rupees} less than the balance we calculated, so our team will check it before paying. You do not need to do anything.`;
}

/**
 * `trips.stage` is the console's four-value enum (`OPEN`, `IN_TRANSIT`,
 * `DELIVERED`, `CLOSED`); `FE.md` §3 shows the transporter six. The two extra
 * values are readable from what the vendor may already see — an LR row means
 * the truck was loaded — so the map is a derivation, not an invention.
 *
 * `REPORTED` has no reachable source: `indents.reported_at` is not in
 * `vendor_api`'s column grant. A trip sits at `PLACED` until its LR is booked.
 */
const STAGE_FOR_STATUS: Record<string, string> = {
  PLACED: 'OPEN',
  REPORTED: 'OPEN',
  LOADED: 'OPEN',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  CLOSED: 'CLOSED',
};

@Injectable()
export class PortalTripsService {
  constructor(
    private readonly repository: PortalTripsRepository,
    private readonly attachments: PortalAttachmentsRepository,
    private readonly storage: PortalStorageService,
    private readonly identity: PortalIdentityRepository,
    private readonly idempotency: PortalIdempotencyRepository,
    private readonly auditService: AuditService,
  ) {}

  async listTrips(vendor: PortalVendor, status?: string): Promise<PortalTripDto[]> {
    const wanted = splitCsv(status);
    const stages = wanted?.length
      ? [...new Set(wanted.map((s) => STAGE_FOR_STATUS[s]).filter(Boolean))]
      : undefined;

    // A `status` naming nothing this system has (a typo, or a stale bookmark)
    // filters to nothing rather than silently returning everything.
    if (wanted?.length && !stages?.length) return [];

    const rows = await this.repository.list(vendor.vendorId, stages);
    const mapped = rows.map((row) => this.toTrip(row));
    const filtered = wanted?.length ? mapped.filter((t) => wanted.includes(t.status)) : mapped;
    return exposeAll(PortalTripDto, filtered);
  }

  async getTrip(vendor: PortalVendor, idOrCode: string): Promise<PortalTripDto> {
    const row = await this.repository.findOne(vendor.vendorId, idOrCode);
    // Another vendor's trip is indistinguishable from one that never existed.
    // `02-redaction-contract.md` §4 assertion 3 — 404, never 403.
    if (!row) throw portalError('NOT_FOUND', 'That trip could not be found.');
    return expose(PortalTripDto, this.toTrip(row));
  }

  async getLorryReceipt(
    vendor: PortalVendor,
    idOrCode: string,
  ): Promise<PortalLorryReceiptDto> {
    const row = await this.repository.findLorryReceipt(vendor.vendorId, idOrCode);
    if (!row) throw portalError('NOT_FOUND', 'No lorry receipt has been issued for that trip.');

    const eway = asRecord(row.eway);
    const advancePaise = row.advancePaise ?? 0;

    return expose(PortalLorryReceiptDto, {
      lrNo: row.lrNo,
      issuedAt: row.issuedAt,
      originCity: row.originCity,
      destinationCity: row.destinationCity,
      goods: goodsDescription(row.goods),
      weightKg: row.weightKg,
      truckType: row.vehicleType,
      vehicleRegistrationNo: row.vehicleRegistrationNo,
      driverName: row.driverName,
      driverLicenceNo: row.driverLicenceNo,
      transitDays: row.lrTransitDays ?? row.transitDaysRequired,
      ewayBillNo: row.ewayBillNo ?? asString(eway?.number),
      ewayValidUpto: row.ewayValidUpto ?? asString(eway?.validTill),
      freightPaise: row.freightPaise,
      advancePaise,
      balancePaise: Math.max(0, row.freightPaise - advancePaise),
      // `05-P4` §2: a signed 15-minute URL to a SERVER-RENDERED document, never
      // a client render of this payload — the paper LR legally names consignor
      // and consignee and this DTO must not. That renderer does not exist yet
      // and is not a read concern; until it lands the field is null rather than
      // a link to a client-side render, which is the leak the split prevents.
      pdfUrl: null,
    });
  }

  // ── Writes — 11-portal.md §5.4 / §5.5 ───────────────────────────────────

  /**
   * `GET /portal/trips/:id/bill` — the state the screen is in BEFORE anyone
   * types a bill number.
   *
   * `07-P6` §2 wants met conditions rendered as well as unmet, which is why
   * this returns the whole checklist rather than a bare `submittable` flag: a
   * transporter who can see "✓ delivered / ✗ proof of delivery not approved"
   * knows what to chase, where a disabled button with no reason reads as a
   * broken screen.
   */
  async getBillChecklist(
    vendor: PortalVendor,
    idOrCode: string,
  ): Promise<PortalBillChecklistDto> {
    const row = await this.repository.findOne(vendor.vendorId, idOrCode);
    if (!row) throw portalError('NOT_FOUND', 'That trip could not be found.');

    const trip = this.toTrip(row);
    const delivered = trip.status === 'DELIVERED' || trip.status === 'CLOSED';
    const podApproved = trip.podStatus === 'APPROVED';
    const alreadyBilled = !!row.billId;

    const conditions = [
      { label: 'Trip delivered', met: delivered },
      { label: 'Proof of delivery approved', met: podApproved },
      ...(alreadyBilled ? [{ label: 'No bill raised yet for this trip', met: false }] : []),
    ];

    return expose(PortalBillChecklistDto, {
      tripId: trip.id,
      submittable: delivered && podApproved && !alreadyBilled,
      conditions,
      freightPaise: trip.freightPaise,
      // `trip_charges` is in `vendor_api`'s blanket REVOKE, so agreed charges
      // are not readable from this pool. Zero is the honest figure here rather
      // than a guess: the bill total below is freight-derived, and a charge the
      // desk agreed separately is settled by them, not asserted by this screen.
      agreedChargesPaise: 0,
      billTotalPaise: trip.netPayablePaise,
      billId: row.billId,
      billNo: null,
      billStatus: null,
      declaration: REVERSE_CHARGE_DECLARATION,
    });
  }

  /**
   * `POST /portal/trips/:id/pod` — `BR-51`.
   *
   * Sets the receipt only. **It does not touch `pod_received_at`, and must not**
   * (`BR-49`, `D-35`): the clock stops when the branch has the paper in hand,
   * not when a photograph reaches us. Every response says so out loud via
   * `penaltyClockRunning` and `notice`, because a transporter who believes the
   * upload was the deadline stops chasing the courier — and that belief costs
   * them ₹100 a day.
   */
  async attachPod(
    vendor: PortalVendor,
    idOrCode: string,
    dto: AttachPodDto,
    files: PortalUploadFile[],
    idempotencyKey: string,
    requestId?: string,
  ): Promise<PortalWriteResult<PortalPodReceiptDto>> {
    const endpoint = PORTAL_ENDPOINT.POD_UPLOAD;

    // Validated, and the bytes stored, BEFORE the envelope opens: a storage
    // write cannot be rolled back by Postgres, so the recoverable ordering is
    // bytes-then-row. See portal-storage.service.ts.
    const docket = (dto.courierDocketNo ?? dto.docketNo ?? '').trim();
    if (!docket) throw portalError('POD_DOCKET_REQUIRED');
    if (!files?.length) throw portalError('POD_FILES_REQUIRED');
    const sentOn = (dto.sentOn ?? '').trim();
    if (!sentOn || sentOn > new Date().toISOString().slice(0, 10)) {
      throw portalError('POD_SENT_ON_INVALID');
    }

    const trip = await this.repository.findOne(vendor.vendorId, idOrCode);
    if (!trip) throw portalError('NOT_FOUND', 'That trip could not be found.');

    const prepared = files.map((f) => this.storage.prepare(f));
    const stored: PortalStoredFile[] = [];
    // Sequential: these are 10 MB buffers going to object storage, and firing
    // a dozen at once from one request is how a phone upload on a bad line
    // times out halfway with some pages stored and some not.
    for (const p of prepared) stored.push(await this.storage.put('pod', trip.id, p));

    return runIdempotentWrite(
      {
        idempotency: this.idempotency,
        vendorId: vendor.vendorId,
        endpoint,
        key: idempotencyKey,
        dto: PortalPodReceiptDto,
      },
      () =>
        this.repository.transaction().execute(async (trx) => {
          const systemUserId = await this.identity.systemUploaderId();
          const attachmentIds = await this.attachments.insertMany(trx, stored, {
            kind: 'POD',
            entityType: 'pod_receipts',
            entityId: trip.id,
            uploadedBy: systemUserId,
          });

          // `BR-52` — a re-attach after a rejection supersedes the last one
          // rather than shadowing it, so the desk can see what changed.
          const previous = await this.repository.latestPodReceipt(trx, trip.id);

          const receipt = await this.repository.insertPodReceipt(trx, {
            tripId: trip.id,
            courierDocket: docket,
            sentOn,
            note: dto.note?.trim() || null,
            pages: stored.length,
            attachmentIds,
            supersedesId: previous?.id ?? null,
          });

          const payload = {
            podId: receipt.id,
            tripId: trip.code,
            status: 'ATTACHED',
            courierDocketNo: receipt.courierDocket,
            sentOn: receipt.sentOn,
            note: receipt.note,
            pages: receipt.pages,
            files: stored.map((f) => ({ id: f.id, mime: f.mime, bytes: f.bytes, url: null })),
            attachedAt: receipt.createdAt,
            penaltyClockRunning: true,
            notice: POD_ATTACH_NOTICE,
          };

          await this.auditService.recordPortalEvent(trx, vendor.vendorId, {
            action: 'PORTAL_POD_ATTACHED',
            entityType: 'pod_receipts',
            entityId: receipt.id,
            after: { tripId: trip.code, courierDocket: docket, sentOn, pages: stored.length },
            requestId,
          });

          await this.idempotency.record(trx, vendor.vendorId, endpoint, idempotencyKey, payload);
          return new PortalWriteResult(expose(PortalPodReceiptDto, payload), false);
        }),
    );
  }

  /**
   * `POST /portal/trips/:id/bill` — `BR-53`, `D-37`.
   *
   * **A bill above our computed balance is accepted and flagged, never
   * rejected.** `07-P6` §3: the transporter may be right — a detention or a
   * loading charge agreed by phone is real money we have not booked yet. The
   * variance is named back immediately in `message`, which is what stops the
   * follow-up call; deciding it is finance's job, not this endpoint's.
   */
  async submitBill(
    vendor: PortalVendor,
    idOrCode: string,
    dto: SubmitBillDto,
    file: PortalUploadFile | undefined,
    idempotencyKey: string,
    requestId?: string,
  ): Promise<PortalWriteResult<PortalVendorBillDto>> {
    const endpoint = PORTAL_ENDPOINT.BILL_SUBMIT;

    const billNo = (dto.billNo ?? '').trim();
    if (!billNo) throw portalError('VALIDATION_ERROR', 'Enter the number printed on your bill.');
    if (!file) throw portalError('BILL_FILE_REQUIRED');
    const billDate = (dto.billDate ?? '').trim();
    if (!billDate) throw portalError('VALIDATION_ERROR', 'Enter the date on your bill.');
    if (billDate > new Date().toISOString().slice(0, 10)) throw portalError('BILL_DATE_FUTURE');

    const row = await this.repository.findOne(vendor.vendorId, idOrCode);
    if (!row) throw portalError('NOT_FOUND', 'That trip could not be found.');

    const trip = this.toTrip(row);
    if (trip.podStatus !== 'APPROVED') throw portalError('POD_NOT_APPROVED');

    const computedBalancePaise = trip.netPayablePaise;
    const billedPaise = dto.billTotalPaise ? Number(dto.billTotalPaise) : computedBalancePaise;

    const prepared = this.storage.prepare(file);
    const stored = await this.storage.put('bills', row.id, prepared);

    return runIdempotentWrite(
      {
        idempotency: this.idempotency,
        vendorId: vendor.vendorId,
        endpoint,
        key: idempotencyKey,
        dto: PortalVendorBillDto,
      },
      () =>
        this.repository.transaction().execute(async (trx) => {
          const clash = await this.repository.findBillByNo(trx, vendor.vendorId, billNo);
          if (clash) throw portalError('BILL_NO_DUPLICATE');

          const systemUserId = await this.identity.systemUploaderId();
          const attachmentId = await this.attachments.insert(trx, stored, {
            kind: 'VENDOR_BILL',
            entityType: 'vendor_bills',
            entityId: row.id,
            uploadedBy: systemUserId,
          });

          const bill = await this.repository.insertVendorBill(trx, {
            tripId: row.id,
            vendorId: vendor.vendorId,
            billNo,
            billDate,
            attachmentId,
            freightPaise: trip.freightPaise,
            chargesPaise: 0,
            totalPaise: billedPaise,
            computedBalancePaise,
          });

          const variancePaise = Number(bill.variancePaise ?? billedPaise - computedBalancePaise);
          const payload = {
            billId: bill.id,
            tripId: trip.id,
            billNo: bill.billNo,
            billDate: bill.billDate,
            status: bill.status,
            computedBalancePaise,
            billedPaise,
            variancePaise,
            flagged: variancePaise !== 0,
            message: varianceMessage(variancePaise),
            submittedAt: bill.submittedAt,
            file: { id: stored.id, mime: stored.mime, bytes: stored.bytes, url: null },
          };

          await this.auditService.recordPortalEvent(trx, vendor.vendorId, {
            action: 'PORTAL_BILL_SUBMITTED',
            entityType: 'vendor_bills',
            entityId: bill.id,
            after: { billNo, billedPaise, computedBalancePaise, variancePaise },
            requestId,
          });

          await this.idempotency.record(trx, vendor.vendorId, endpoint, idempotencyKey, payload);
          return new PortalWriteResult(expose(PortalVendorBillDto, payload), false);
        }),
    );
  }

  private toTrip(row: TripRow) {
    const podStatus = podStatusFor(row);
    const freightPaise = row.freightPaise;
    const advancePct = row.advancePct ?? 0;
    // Released amount when there is one, the policy entitlement before that —
    // the card leads with "what is owed" and an unreleased advance is still owed.
    const advancePaise =
      row.advancePaidPaise > 0
        ? row.advancePaidPaise
        : Math.floor((freightPaise * advancePct) / 100);
    const balancePaise = Math.max(0, freightPaise - advancePaise);

    const { ageDays, penaltyPaise: accruing } = computePenalty(
      row.deliveredAt,
      row.podReceivedAt,
    );
    // Once the clock has stopped the stored figure is the settled one (`BR-49`
    // — receipt stops the clock, and `BR-43`'s waiver only ever lowers it).
    // While it runs, the transporter is shown the larger of the two so the
    // screen never under-states what a late POD is costing them.
    const penaltyPaise = row.podReceivedAt
      ? row.podPenaltyPaise
      : Math.max(row.podPenaltyPaise, accruing);

    return {
      id: row.code,
      lrNo: row.lrNo,
      originCity: row.originCity,
      destinationCity: row.destinationCity,
      // See portal-loads.service.ts — no lane distance exists under this grant.
      distanceKm: null,
      status: row.stage === 'OPEN' ? (row.lrNo ? 'LOADED' : 'PLACED') : row.stage,
      podStatus,
      podRejectionReason: podStatus === 'REJECTED' ? (row.podRejectionReason ?? null) : null,
      vehicleRegistrationNo: row.vehicleRegistrationNo,
      driverName: row.driverName,
      driverPhone: row.driverPhone,
      freightPaise,
      advancePct,
      advancePaise,
      // `payments` is in `vendor_api`'s blanket REVOKE (`20260814090200` §2),
      // so neither the release timestamp nor the UTR is reachable from this
      // pool. Null rather than absent: the screen has a slot for both and an
      // empty slot is a visible gap, where a missing key looks like a bug.
      advanceReleasedAt: null,
      advanceUtr: null,
      // `BR-58`'s gating set lives in `trip_documents`, also revoked. An empty
      // list reads on screen as "nothing is blocking your advance", which is
      // not something this pool can actually assert — flagged here rather than
      // papered over with a guess drawn from `vendor_documents`, which is a
      // different set of documents entirely.
      advanceBlockers: [],
      balancePaise,
      penaltyPaise,
      netPayablePaise: Math.max(0, balancePaise - penaltyPaise),
      deliveredAt: row.deliveredAt,
      podDaysElapsed: ageDays,
      podPenaltyPerDayPaise: POD_PENALTY_PER_DAY_PAISE,
      billId: row.billId,
      milestones: milestones(row, podStatus),
    };
  }
}

/**
 * `trips.pod_status` as the transporter should read it.
 *
 * `ATTACHED` is the portal's own value (`20260814090100` §trips) and this pool
 * holds no `update` on `trips`, so it is derived from the presence of a
 * `pod_receipts` row carrying a courier docket rather than stored. The
 * promotion applies to `PENDING` only: once the desk has moved the trip to
 * `RECEIVED`, `VERIFIED`, `APPROVED`, `REJECTED` or `FORFEITED`, the stored
 * value is further along than anything this side can infer and wins.
 *
 * `REJECTED` is deliberately promotable back to `ATTACHED` — a rejected POD
 * that has been re-attached is attached again (`BR-52`), and the re-attachment
 * is newer than the rejection by construction, since the rejection was recorded
 * against the receipt this one supersedes.
 */
function podStatusFor(row: {
  podStatus: string;
  podAttachedAt: string | null;
  podReceivedAt: string | null;
}): string {
  if (!row.podAttachedAt) return row.podStatus;
  if (row.podStatus === 'PENDING') return 'ATTACHED';
  return row.podStatus;
}

type TripRow = {
  id: string;
  code: string;
  vehicleRegistrationNo: string;
  vehicleType: string | null;
  driverName: string | null;
  driverPhone: string | null;
  stage: string;
  deliveredAt: string | null;
  podStatus: string;
  podReceivedAt: string | null;
  podPenaltyPaise: number;
  podRejectionReason: string | null;
  /** Derived, not stored — see `portal-trips.repository.ts` and `podStatusFor`. */
  podAttachedAt: string | null;
  freightPaise: number;
  advancePaidPaise: number;
  balancePaidPaise: number;
  originCity: string;
  destinationCity: string;
  advancePct: number;
  lrNo: string | null;
  lrBookedAt: string | null;
  billId: string | null;
};

/**
 * `BR-24` / `BR-49`, and the same arithmetic `PodService.computePenalty` runs
 * on the console side — the two must agree or the transporter and the desk are
 * reading different numbers off the same trip. The rate and the two thresholds
 * come from `portal.constants.ts`, which records why `config` cannot be read
 * from this pool.
 */
function computePenalty(
  deliveredAt: string | null,
  podReceivedAt: string | null,
): { ageDays: number | null; penaltyPaise: number } {
  if (!deliveredAt) return { ageDays: null, penaltyPaise: 0 };
  const delivered = new Date(deliveredAt).getTime();
  const clockEnd = podReceivedAt ? new Date(podReceivedAt).getTime() : Date.now();
  const ageDays = Math.max(0, Math.floor((clockEnd - delivered) / 86_400_000));
  const penaltyDays = Math.max(0, Math.min(ageDays, POD_FORFEIT_DAYS) - POD_TAT_DAYS);
  return { ageDays, penaltyPaise: penaltyDays * POD_PENALTY_PER_DAY_PAISE };
}

/**
 * `05-P4` §1: "Render all three always, with the unavailable ones disabled and
 * stating what would unblock them. A hidden button teaches nothing." The
 * milestone strip is the same argument — every step is listed, done or not.
 *
 * No `REPORTED` step: nothing this pool may read records it.
 */
function milestones(row: TripRow, podStatus: string) {
  const inTransit = ['IN_TRANSIT', 'DELIVERED', 'CLOSED'].includes(row.stage);
  return [
    { key: 'PLACED', label: 'Placement confirmed', at: null, done: true },
    { key: 'LOADED', label: 'Loaded, LR issued', at: row.lrBookedAt, done: Boolean(row.lrNo) },
    { key: 'IN_TRANSIT', label: 'In transit', at: null, done: inTransit },
    {
      key: 'DELIVERED',
      label: `Delivered at ${row.destinationCity}`,
      at: row.deliveredAt,
      done: Boolean(row.deliveredAt),
    },
    {
      key: 'POD',
      label: podMilestoneLabel(podStatus),
      // `pod_received_at` and not the attach time, on purpose: this timestamp is
      // when the clock stopped (`BR-49`), and attaching does not stop it. A
      // milestone dated by the upload would say the opposite.
      at: row.podReceivedAt,
      done: podStatus === 'APPROVED',
    },
  ];
}

function podMilestoneLabel(podStatus: string): string {
  switch (podStatus) {
    case 'APPROVED':
      return 'POD approved';
    case 'REJECTED':
      return 'POD rejected — re-attach';
    case 'ATTACHED':
      return 'POD attached, awaiting the paper copy';
    case 'RECEIVED':
    case 'VERIFIED':
      return 'POD with the desk';
    default:
      return 'POD awaited';
  }
}

/** `lorry_receipts.goods` is a jsonb snapshot (`PatchLrDto.goods`), not a string. */
function goodsDescription(goods: unknown): string {
  const record = asRecord(goods);
  return asString(record?.description) ?? asString(record?.material) ?? '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function splitCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  const parts = value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}
