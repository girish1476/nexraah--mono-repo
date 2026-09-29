import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DomainException, assertReason } from '../../common/domain-exception';
import { assertAnyPermission } from '../../common/guards/assert-any-permission';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { ApprovalRequiredResponse } from '../../common/approval-required.response';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalsRegistry } from '../approvals/approvals.registry';
import { ConfigRepository } from '../config/config.repository';
import { OrdersService } from '../orders/orders.service';
import { TRIP_DOCUMENT_KINDS } from './trips.constants';
import { TripsRepository, type TripListFilters } from './trips.repository';
import type { SubmitTripDocumentDto } from './dto/submit-document.dto';
import type { CreateChargeDto } from './dto/create-charge.dto';
import type { PatchLrDto } from './dto/patch-lr.dto';
import type { DeliverTripDto } from './dto/deliver-trip.dto';

interface CrossCheckOverrideAction {
  tripId: string;
}

export interface CrossCheckMismatch {
  field: string;
  a: { source: string; value: string | null };
  b: { source: string; value: string | null };
}

@Injectable()
export class TripsService implements OnModuleInit {
  constructor(
    private readonly tripsRepository: TripsRepository,
    private readonly configRepository: ConfigRepository,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
    private readonly approvalsService: ApprovalsService,
    private readonly approvalsRegistry: ApprovalsRegistry,
    private readonly ordersService: OrdersService,
  ) {}

  private readonly logger = new Logger('TripsService');

  /**
   * Moves the ten-step order ladder after a trip transition has COMMITTED.
   *
   * Never call this inside the transaction that produced the change.
   * `recompute()` reads through `OrdersRepository`'s own executor rather than
   * any transaction passed to it, so running it inside `trx` reads pre-commit
   * state and records the *previous* step — silently, with nothing thrown.
   *
   * Non-fatal on purpose: the trip really did depart. Failing the request
   * because a derived status could not be refreshed would be a worse bug than
   * a stale status, and `OrdersService.reconcile()` repairs anything missed
   * here. It is logged at error level so it is never silent.
   */
  private async syncOrder(
    indentId: string | null | undefined,
    actor: AuthenticatedUser | null,
    note: string | null = null,
  ) {
    if (!indentId) return;
    try {
      await this.ordersService.recompute(indentId, actor, note);
    } catch (e) {
      this.logger.error(
        `Order recompute failed for indent ${indentId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  onModuleInit() {
    // BR-44: leadership-adjacent override of an open cross-check mismatch.
    // Nothing to replay beyond flipping the flag — the mismatch itself isn't
    // recomputed or cleared, just acknowledged.
    this.approvalsRegistry.register('DOC_OVERRIDE', 'trips', async (action: CrossCheckOverrideAction, ctx) => {
      // ctx.db is ApprovalsService.approve()'s own transaction — see the
      // deadlock/atomicity note on ApprovalHandler (approvals.types.ts).
      await this.tripsRepository.update(ctx.db, action.tripId, { cross_check_overridden: true });
      await this.auditService.record(ctx.db, { userId: ctx.approverId, role: ctx.approverRole }, {
        action: 'OVERRIDE',
        entityType: 'trips',
        entityId: action.tripId,
        after: { crossCheckOverridden: true },
      });
    });
  }

  async list(filters: TripListFilters) {
    const rows = await this.tripsRepository.list(filters);
    return rows;
  }

  async getById(id: string) {
    const trip = await this.tripsRepository.findById(id);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${id}`);

    const indent = await this.tripsRepository.findIndentForTrip(trip.indent_id);
    const [documents, charges, lr] = await Promise.all([
      this.documentsFor(id),
      this.tripsRepository.findCharges(id),
      this.tripsRepository.findLr(id),
    ]);

    const transitDelay =
      trip.actual_transit_days != null && trip.transit_days_required != null
        ? trip.actual_transit_days > trip.transit_days_required
        : false;

    return {
      id: trip.id,
      code: trip.code,
      indentId: trip.indent_id,
      indentCode: trip.indentCode,
      lrCode: trip.lrCode,
      clientName: trip.clientName,
      vendorName: trip.vendorName,
      branchName: trip.branchName,
      lane: trip.lane,
      vehicleNo: trip.vehicle_no,
      vehicleType: trip.vehicle_type,
      capacityTn: trip.capacity_kg != null ? trip.capacity_kg / 1000 : null,
      weightTn: trip.weight_kg != null ? trip.weight_kg / 1000 : null,
      driverName: trip.driver_name,
      driverLicence: trip.driver_licence,
      transitDaysRequired: trip.transit_days_required,
      actualTransitDays: trip.actual_transit_days,
      transitDelay,
      remarks: trip.remarks,
      advancePct: indent?.advance_pct ?? null,
      buyRatePaise: trip.buy_rate,
      sellRatePaise: indent?.sell_rate ?? null,
      ewayNo: trip.eway_no,
      ewayValidTill: trip.eway_valid_till,
      stage: trip.stage,
      deliveredAt: trip.delivered_at,
      podStatus: trip.pod_status,
      podReceivedAt: trip.pod_received_at,
      podClosureBasis: trip.pod_closure_basis,
      advancePaidPaise: trip.advance_paid,
      balancePaidPaise: trip.balance_paid,
      podPenaltyPaise: trip.podPenaltyPaise,
      billed: trip.billed,
      documents,
      charges: charges.map((c) => ({
        id: c.id,
        chargeType: c.chargeType,
        costAmountPaise: c.costAmountPaise,
        billedAmountPaise: c.billedAmountPaise,
        capturedBy: c.capturedBy,
        capturedAt: c.capturedAt,
      })),
      lr: lr ? this.lrToDto(lr) : null,
    };
  }

  // ---- Documents ----------------------------------------------------

  async listDocuments(tripId: string) {
    await this.assertTripExists(tripId);
    return this.documentsFor(tripId);
  }

  private async documentsFor(tripId: string) {
    const [rows, advanceDocumentSet] = await Promise.all([
      this.tripsRepository.findDocuments(tripId),
      this.advanceDocumentSet(),
    ]);
    const byKind = new Map(rows.map((r) => [r.kind, r]));

    return TRIP_DOCUMENT_KINDS.map((meta) => {
      const row = byKind.get(meta.kind);
      return {
        kind: meta.kind,
        label: meta.label,
        group: meta.group,
        // docs/api/04: "must be computed from config.advance_document_set,
        // not hard-coded" — removing a member there is an audited change
        // that releases money previously held.
        gatesAdvance: advanceDocumentSet.has(meta.kind),
        status: row?.status ?? 'MISSING',
        attachmentId: row?.attachment_id ?? null,
        uploadedAt: row?.created_at ?? null,
        verifiedBy: row?.verified_by ?? null,
        verifiedAt: row?.verified_at ?? null,
        rejectReason: row?.reject_reason ?? null,
        keyedValues: row?.keyed_values ?? null,
      };
    });
  }

  private async advanceDocumentSet(): Promise<Set<string>> {
    const config = await this.configRepository.findAll();
    const raw = config.get('advance_document_set');
    return new Set(Array.isArray(raw) ? (raw as string[]) : []);
  }

  async submitDocument(tripId: string, kind: string, dto: SubmitTripDocumentDto, actor: AuthenticatedUser) {
    assertAnyPermission(actor, ['document.verify', 'indent.manage']);
    this.assertKnownKind(kind);
    const trip = await this.assertTripExists(tripId);

    const result = await this.tripsRepository.transaction().execute(async (trx) => {
      const row = await this.tripsRepository.upsertDocument(trx, {
        tripId,
        kind,
        attachmentId: dto.attachmentId ?? null,
        keyedValues: dto.keyedValues,
      });
      await this.auditService.record(trx, actor, {
        action: 'TRIP_DOCUMENT_SUBMITTED',
        entityType: 'trip_documents',
        entityId: row.id,
        after: { tripId, kind },
      });
      return { kind: row.kind, status: row.status };
    });
    // Step 4, "Advance docs uploaded" — only the configured advance-gating
    // kinds actually move the ladder, and `recompute` decides which those are.
    await this.syncOrder(trip.indent_id, actor);
    return result;
  }

  async verifyDocument(tripId: string, kind: string, actor: AuthenticatedUser) {
    this.assertKnownKind(kind);
    const result = await this.tripsRepository.transaction().execute(async (trx) => {
      const existing = await this.tripsRepository.findDocumentOne(trx, tripId, kind);
      if (!existing) throw new DomainException(404, 'NOT_FOUND', `${kind} has not been uploaded for trip ${tripId}.`);

      const row = await this.tripsRepository.decideDocument(trx, tripId, kind, 'VERIFIED', actor.userId, null);
      await this.auditService.record(trx, actor, {
        action: 'DOC_VERIFY',
        entityType: 'trip_documents',
        entityId: row.id,
        before: { status: existing.status },
        after: { status: row.status },
      });
      return { kind: row.kind, status: row.status };
    });
    await this.syncOrder(await this.indentIdForTrip(tripId), actor);
    return result;
  }

  async rejectDocument(tripId: string, kind: string, reason: string, actor: AuthenticatedUser) {
    this.assertKnownKind(kind);
    if (!reason || reason.trim().length === 0) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'A reason is required to reject a document.');
    }

    const result = await this.tripsRepository.transaction().execute(async (trx) => {
      const existing = await this.tripsRepository.findDocumentOne(trx, tripId, kind);
      if (!existing) throw new DomainException(404, 'NOT_FOUND', `${kind} has not been uploaded for trip ${tripId}.`);

      const row = await this.tripsRepository.decideDocument(trx, tripId, kind, 'REJECTED', actor.userId, reason);
      await this.auditService.record(trx, actor, {
        action: 'DOC_VERIFY',
        entityType: 'trip_documents',
        entityId: row.id,
        before: { status: existing.status },
        after: { status: row.status, reason },
      });
      return { kind: row.kind, status: row.status };
    });
    // A rejection can move the ladder BACKWARDS off "Advance docs uploaded" —
    // which is correct, and is why the history table is append-only.
    await this.syncOrder(await this.indentIdForTrip(tripId), actor, `Document rejected: ${kind}`);
    return result;
  }

  // ---- Cross-check --------------------------------------------------

  async crossCheck(tripId: string) {
    const trip = await this.tripsRepository.findById(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

    const [docs, lr] = await Promise.all([this.tripsRepository.findDocuments(tripId), this.tripsRepository.findLr(tripId)]);
    const invoiceDoc = docs.find((d) => d.kind === 'CLIENT_INVOICE_OR_PO');
    const ewayDoc = docs.find((d) => d.kind === 'EWAY_BILL');

    const waitingOn: string[] = [];
    if (!invoiceDoc?.keyed_values) waitingOn.push('Client invoice');
    if (!ewayDoc?.keyed_values) waitingOn.push('E-way bill');
    if (!lr) waitingOn.push('Lorry receipt');

    if (waitingOn.length > 0) {
      return { runnable: false, waitingOn, mismatches: [], overridden: trip.cross_check_overridden };
    }

    const invoiceKeyed = invoiceDoc!.keyed_values as Record<string, unknown>;
    const ewayKeyed = ewayDoc!.keyed_values as Record<string, unknown>;
    const lrInvoice = (lr!.invoice as Record<string, unknown> | null) ?? {};
    const lrVehicle = (lr!.vehicle as Record<string, unknown> | null) ?? {};
    const lrConsignor = (lr!.consignor as Record<string, unknown> | null) ?? {};
    const lrConsignee = (lr!.consignee as Record<string, unknown> | null) ?? {};

    const mismatches: CrossCheckMismatch[] = [];
    const compare = (field: string, aSource: string, aValue: unknown, bSource: string, bValue: unknown) => {
      const norm = (v: unknown) => (v == null ? '' : String(v).replace(/\s+/g, '').toUpperCase());
      if (norm(aValue) !== norm(bValue)) {
        mismatches.push({
          field,
          a: { source: aSource, value: aValue == null ? null : String(aValue) },
          b: { source: bSource, value: bValue == null ? null : String(bValue) },
        });
      }
    };

    compare('Invoice number', 'Client invoice', invoiceKeyed.invoiceNo, 'Lorry receipt', lrInvoice.number);
    compare('Invoice value', 'Client invoice', invoiceKeyed.invoiceValue, 'Lorry receipt', lrInvoice.valuePaise);
    compare('Vehicle number', 'E-way bill', ewayKeyed.vehicleNo, 'Lorry receipt', lrVehicle.registration);
    compare('Consignor GSTIN', 'Client invoice', invoiceKeyed.consignorGstin, 'Lorry receipt', lrConsignor.gstin);
    compare('Consignee', 'Client invoice', invoiceKeyed.consigneeName, 'Lorry receipt', lrConsignee.name);

    // E-way validity ≥ expected delivery (pickup + transit days required).
    const expectedDelivery = this.expectedDeliveryDate(trip);
    const validTill = ewayKeyed.validTill ? new Date(String(ewayKeyed.validTill)) : null;
    if (expectedDelivery && (!validTill || validTill < expectedDelivery)) {
      mismatches.push({
        field: 'E-way validity',
        a: { source: 'E-way bill', value: ewayKeyed.validTill == null ? null : String(ewayKeyed.validTill) },
        b: { source: 'Expected delivery', value: expectedDelivery.toISOString().slice(0, 10) },
      });
    }

    return { runnable: true, waitingOn: [], overridden: trip.cross_check_overridden, mismatches };
  }

  async overrideCrossCheck(
    tripId: string,
    reason: string,
    actor: AuthenticatedUser,
  ): Promise<ApprovalRequiredResponse> {
    // Who may *ask* for an override: the desks that read the papers —
    // Compliance (`document.verify`) and the Ops desk running the trip
    // (`indent.manage`), matching what `trips/[id]/documents` offers. The
    // decision itself is still an approval senior to ops (BR-44, D-28).
    assertAnyPermission(actor, ['document.verify', 'indent.manage']);
    assertReason(reason);
    const trip = await this.tripsRepository.findById(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

    const action: CrossCheckOverrideAction = { tripId };
    return this.approvalsService.raise(
      {
        kind: 'DOC_OVERRIDE',
        entityType: 'trips',
        entityId: tripId,
        reason,
        title: `Cross-check override · ${trip.code}`,
        detail: 'Proceeding with an open, unresolved cross-check mismatch.',
        amountPaise: null,
        action,
      },
      actor,
    );
  }

  // ---- Charges --------------------------------------------------------

  async listCharges(tripId: string) {
    return this.tripsRepository.findCharges(tripId);
  }

  // BR-45: a billed figure below cost is a warning, not a refusal — the
  // frontend renders it; nothing here blocks it.
  async createCharge(tripId: string, dto: CreateChargeDto, actor: AuthenticatedUser) {
    // A charge is money on both sides of the trip. Captured by whoever is
    // reading the document (part 05 §4) — Compliance on advance papers, the
    // POD desk on delivery papers, Ops on a trip they run — the same three
    // the portal's `trips/[id]/charges` page offers the form to.
    assertAnyPermission(actor, ['document.verify', 'pod.verify', 'indent.manage']);
    await this.assertTripExists(tripId);
    const row = await this.tripsRepository.transaction().execute(async (trx) => {
      const inserted = await this.tripsRepository.insertCharge(trx, {
        tripId,
        chargeType: dto.chargeType,
        costAmountPaise: dto.costAmountPaise,
        billedAmountPaise: dto.billedAmountPaise,
        capturedBy: actor.userId,
      });
      await this.auditService.record(trx, actor, {
        action: 'TRIP_CHARGE_CAPTURED',
        entityType: 'trip_charges',
        entityId: inserted.id,
        after: { tripId, chargeType: dto.chargeType, costAmountPaise: dto.costAmountPaise, billedAmountPaise: dto.billedAmountPaise },
      });
      return inserted;
    });
    return { id: row.id, chargeType: row.charge_type, costAmountPaise: row.cost_amount, billedAmountPaise: row.billed_amount };
  }

  // ---- Lorry receipt ----------------------------------------------------

  async getLr(tripId: string) {
    const lr = await this.tripsRepository.findLr(tripId);
    return lr ? this.lrToDto(lr) : null;
  }

  async patchLr(tripId: string, dto: PatchLrDto, actor: AuthenticatedUser) {
    const trip = await this.tripsRepository.findById(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

    const existing = await this.tripsRepository.findLr(tripId);
    const patch: Record<string, unknown> = {};
    if (dto.consignor !== undefined) patch.consignor = JSON.stringify(dto.consignor);
    if (dto.consignee !== undefined) patch.consignee = JSON.stringify(dto.consignee);
    if (dto.goods !== undefined) patch.goods = JSON.stringify(dto.goods);
    if (dto.invoice !== undefined) patch.invoice = JSON.stringify(dto.invoice);
    if (dto.eway !== undefined) patch.eway = JSON.stringify(dto.eway);
    if (dto.vehicle !== undefined) patch.vehicle = JSON.stringify(dto.vehicle);
    if (dto.driver !== undefined) patch.driver = JSON.stringify(dto.driver);
    if (dto.transitDays !== undefined) patch.transit_days = dto.transitDays;
    if (dto.remarks !== undefined) patch.remarks = dto.remarks;
    if (dto.chargeHeads !== undefined) patch.charges = JSON.stringify(dto.chargeHeads);

    // The DB requires consignor/consignee to at least carry `name` (the
    // printed LR's legal minimum). A brand-new draft that hasn't supplied
    // one yet gets a placeholder from the trip's own client/vehicle/driver
    // data so the first autosave doesn't fail the CHECK constraint — the
    // frontend seeding "from the trip" (docs/api/04) is exactly this data.
    if (!existing) {
      if (!dto.consignor) patch.consignor = JSON.stringify({ name: '' });
      if (!dto.consignee) patch.consignee = JSON.stringify({ name: '' });
      if (!dto.goods) patch.goods = JSON.stringify({});
      // vehicle/driver are NOT NULL too — same reasoning as above, seeded
      // from the trip's own placement data rather than left for the caller.
      if (!dto.vehicle) patch.vehicle = JSON.stringify({ registration: trip.vehicle_no, type: trip.vehicle_type ?? '' });
      if (!dto.driver) patch.driver = JSON.stringify({ name: trip.driver_name ?? '', licence: trip.driver_licence ?? '' });
    }

    const row = await this.tripsRepository
      .transaction()
      .execute((trx) => this.tripsRepository.upsertLrDraft(trx, tripId, trip.branch_id, patch));
    return this.lrToDto(row);
  }

  async generateLr(tripId: string, actor: AuthenticatedUser) {
    let indentId: string | null = null;
    const lr = await this.tripsRepository.transaction().execute(async (trx) => {
      const trip = await this.tripsRepository.findByIdForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);

      // BR-13: no LR before the truck is placed. By the time a trip exists it
      // was created from a VEHICLE_PLACED indent (indents.service.ts), so
      // this is a defensive re-check against the copied vehicle_no.
      if (!trip.vehicle_no) {
        throw new DomainException(409, 'NOT_PLACED', 'No vehicle is placed on this trip yet.');
      }
      indentId = trip.indent_id;

      const existingLr = await this.tripsRepository.findLrForUpdate(trx, tripId);
      if (existingLr?.status && existingLr.status !== 'BOOKED') {
        throw new DomainException(409, 'LR_EXISTS', 'A lorry receipt already exists for this trip.');
      }
      if (!existingLr) {
        throw new DomainException(409, 'LR_DRAFT_REQUIRED', 'Save an LR draft (PATCH) before generating it.');
      }

      // BR-32: an open, unoverridden cross-check mismatch blocks generation.
      const crossCheck = await this.crossCheck(tripId);
      if (crossCheck.mismatches.length > 0 && !trip.cross_check_overridden) {
        throw new DomainException(409, 'CROSS_CHECK_MISMATCH', 'Resolve or override the open cross-check mismatch first.', {
          mismatches: crossCheck.mismatches,
        });
      }

      // BR-14: consumed inside the issuing transaction.
      const code = await this.numberingService.issue(trx, 'LR');
      const row = await this.tripsRepository.finalizeLr(trx, tripId, code);

      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'lorry_receipts',
        entityId: row.id,
        after: { code, status: row.status },
      });
      return this.lrToDto(row);
    });
    // Step 3, "LR issued".
    await this.syncOrder(indentId, actor);
    return lr;
  }

  async shareLr(tripId: string) {
    const lr = await this.tripsRepository.findLr(tripId);
    if (!lr) throw new DomainException(404, 'NOT_FOUND', `No lorry receipt exists for trip ${tripId}.`);
    const row = await this.tripsRepository.shareLr(tripId);
    return this.lrToDto(row);
  }

  // ---- Stage transitions ---------------------------------------------
  //
  // Nothing previously moved a trip from OPEN through IN_TRANSIT to
  // DELIVERED — no endpoint, no spec. `payments.service.ts` already sets
  // stage: 'CLOSED' directly at balance release/forfeiture, so that
  // transition exists; these two are the missing middle of the ladder.

  async depart(tripId: string, actor: AuthenticatedUser) {
    let indentId: string | null = null;
    await this.tripsRepository.transaction().execute(async (trx) => {
      const trip = await this.tripsRepository.findByIdForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      indentId = trip.indent_id;
      if (trip.stage !== 'OPEN') {
        throw new DomainException(409, 'NOT_OPEN', `Trip ${trip.code} is not OPEN (currently ${trip.stage}).`);
      }
      const lr = await this.tripsRepository.findLrForUpdate(trx, tripId);
      if (!lr || lr.status !== 'RELEASED') {
        throw new DomainException(409, 'LR_NOT_GENERATED', 'The lorry receipt must be generated before departure.');
      }

      await this.tripsRepository.update(trx, tripId, { stage: 'IN_TRANSIT' });
      await this.tripsRepository.updateLrStatus(trx, tripId, 'IN_TRANSIT');
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'trips',
        entityId: tripId,
        before: { stage: trip.stage },
        after: { stage: 'IN_TRANSIT' },
      });
    });
    // Step 6, "Tracking" — after commit, so the ladder reads the new stage.
    await this.syncOrder(indentId, actor);
    return this.getById(tripId);
  }

  async deliver(tripId: string, dto: DeliverTripDto, actor: AuthenticatedUser) {
    let indentId: string | null = null;
    await this.tripsRepository.transaction().execute(async (trx) => {
      const trip = await this.tripsRepository.findByIdForUpdate(trx, tripId);
      if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
      indentId = trip.indent_id;
      if (trip.stage !== 'IN_TRANSIT') {
        throw new DomainException(409, 'NOT_IN_TRANSIT', `Trip ${trip.code} is not IN_TRANSIT (currently ${trip.stage}).`);
      }

      const deliveredAt = dto.deliveredAt ?? new Date().toISOString();
      // docs/api/05-pod.md: "PENDING | System, on delivery" — the one hard
      // rule the spec states about this transition.
      await this.tripsRepository.update(trx, tripId, {
        stage: 'DELIVERED',
        delivered_at: deliveredAt,
        pod_status: 'PENDING',
      });
      await this.tripsRepository.updateLrStatus(trx, tripId, 'DELIVERED');
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'trips',
        entityId: tripId,
        before: { stage: trip.stage },
        after: { stage: 'DELIVERED', deliveredAt, podStatus: 'PENDING' },
      });
    });
    // Step 7, "Unloaded" — delivery also opens the POD clock, so the ladder
    // moves to UNLOADED here and waits for a receipt to reach step 8.
    await this.syncOrder(indentId, actor);
    return this.getById(tripId);
  }

  // ---- Helpers ------------------------------------------------------

  private assertKnownKind(kind: string) {
    if (!TRIP_DOCUMENT_KINDS.some((k) => k.kind === kind)) {
      throw new DomainException(400, 'VALIDATION_ERROR', `Unknown document kind: ${kind}.`);
    }
  }

  /** `orders.indent_id` is the ladder's key — a trip is only one thing that moves it. */
  private async indentIdForTrip(tripId: string): Promise<string | null> {
    const trip = await this.tripsRepository.findById(tripId);
    return trip?.indent_id ?? null;
  }

  private async assertTripExists(tripId: string) {
    const trip = await this.tripsRepository.findById(tripId);
    if (!trip) throw new DomainException(404, 'NOT_FOUND', `Unknown trip: ${tripId}`);
    return trip;
  }

  private expectedDeliveryDate(trip: { created_at: string; transit_days_required: number | null }): Date | null {
    if (trip.transit_days_required == null) return null;
    const date = new Date(trip.created_at);
    date.setDate(date.getDate() + trip.transit_days_required);
    return date;
  }

  private lrToDto(row: {
    code: string;
    status: string;
    lr_date: string;
    booked_at: string;
    shared_at: string | null;
    consignor: unknown;
    consignee: unknown;
    goods: unknown;
    invoice: unknown;
    eway: unknown;
    vehicle: unknown;
    driver: unknown;
    transit_days: number | null;
    remarks: string | null;
    charges: unknown;
  }) {
    return {
      code: row.code,
      status: row.status,
      lrDate: row.lr_date,
      bookedAt: row.booked_at,
      sharedAt: row.shared_at,
      consignor: row.consignor,
      consignee: row.consignee,
      goods: row.goods,
      invoice: row.invoice,
      eway: row.eway,
      vehicle: row.vehicle,
      driver: row.driver,
      transitDays: row.transit_days,
      remarks: row.remarks,
      chargeHeads: row.charges,
    };
  }
}
