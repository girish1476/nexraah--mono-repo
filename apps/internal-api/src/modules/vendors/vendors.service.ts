import { Injectable, OnModuleInit } from '@nestjs/common';
import { DomainException, assertReason, type UnmetItem } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { ApprovalRequiredResponse } from '../../common/approval-required.response';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalsRegistry } from '../approvals/approvals.registry';
import {
  ALWAYS_MANDATORY_DOCUMENT_KINDS,
  DOCUMENT_KINDS,
  KYC_KINDS,
  LEGAL_DOCUMENT_KINDS,
  MANDATORY_KYC_KINDS,
} from './vendors.constants';
import { VendorsRepository, type VendorListFilters } from './vendors.repository';
import { VendorPortalAccountService } from './vendor-portal-account.service';
import { LeadsRepository } from './leads.repository';
import { AADHAAR_LAST4_RE, FORMAT_MESSAGE, PAN_RE } from '../../common/validation/formats';
import type { BackfillKycValueDto } from './dto/backfill-kyc-value.dto';
import {
  EXPIRING_DOCUMENT_KINDS,
  EXPIRY_WARNING_DAYS,
  buildExpiryQueue,
  vendorExpiryReport,
} from './vendor-document-expiry';
import type { CreateVendorDto } from './dto/create-vendor.dto';
import type { UpdateVendorDto } from './dto/update-vendor.dto';
import type { SubmitKycDto } from './dto/submit-kyc.dto';
import type { SubmitDocumentDto } from './dto/submit-document.dto';
import type { AdvancePolicyDto } from './dto/advance-policy.dto';

interface AdvancePolicyChangeAction {
  vendorId: string;
  newPct: number;
}

interface BranchOverrideAction {
  vendorId: string;
  branchId: string;
}

@Injectable()
export class VendorsService implements OnModuleInit {
  constructor(
    private readonly vendorsRepository: VendorsRepository,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
    private readonly approvalsService: ApprovalsService,
    private readonly approvalsRegistry: ApprovalsRegistry,
    private readonly portalAccountService: VendorPortalAccountService,
    private readonly leadsRepository: LeadsRepository,
  ) {}

  onModuleInit() {
    // BR-57: replayed verbatim on approval, never recomputed — the pct that
    // was true when leadership agreed to it is the pct that gets written.
    this.approvalsRegistry.register('ADVANCE_POLICY_CHANGE', 'vendors', async (action: AdvancePolicyChangeAction, ctx) => {
      // Runs inside ApprovalsService.approve()'s own transaction (ctx.db) —
      // never a second, independent one. approve() holds `approvals` FOR
      // UPDATE for the whole call; insertAdvanceHistory's `approval_id` FK
      // references that exact row, so a handler-owned transaction here
      // deadlocks against the still-open outer one (approvals.types.ts).
      const vendor = await this.vendorsRepository.findByIdForUpdate(ctx.db, action.vendorId);
      if (!vendor) {
        throw new DomainException(409, 'VENDOR_NOT_FOUND', `Vendor ${action.vendorId} no longer exists.`);
      }
      await this.vendorsRepository.insertAdvanceHistory(ctx.db, {
        vendorId: action.vendorId,
        oldPct: vendor.advance_pct,
        newPct: action.newPct,
        approvalId: ctx.approvalId,
        changedBy: ctx.approverId,
      });
      await this.vendorsRepository.update(ctx.db, action.vendorId, { advance_pct: action.newPct });
    });

    // BR-47: leadership overriding the catchment-derived branch on an already
    // decided (non-DRAFT) vendor. Draft-stage branch choice is direct with a
    // recorded reason (see `deriveBranch`) — this handler is for changing it
    // after the fact, which is a heavier action and goes through the engine.
    this.approvalsRegistry.register('BRANCH_OVERRIDE', 'vendors', async (action: BranchOverrideAction, ctx) => {
      const vendor = await this.vendorsRepository.findByIdForUpdate(ctx.db, action.vendorId);
      if (!vendor) {
        throw new DomainException(409, 'VENDOR_NOT_FOUND', `Vendor ${action.vendorId} no longer exists.`);
      }
      await this.vendorsRepository.update(ctx.db, action.vendorId, { branch_id: action.branchId });
    });
  }

  // ---- Periodic document audit ---------------------------------------

  /**
   * Which ACTIVE transporters have legal papers that have lapsed, or are about
   * to.
   *
   * `vendor_documents.valid_to` has been captured and displayed since day one
   * and read by nothing — so a transporter whose trade licence expired a year
   * ago stayed ACTIVE, passed BR-01 at award, and kept being given loads. The
   * award gate in `indents.service.ts` now refuses that. This is the other
   * half: the queue that lets Compliance chase the paper *before* it stops a
   * truck, rather than finding out when an award is refused.
   *
   * Expired first, then soonest-to-expire — the order the work should be done
   * in, not alphabetical.
   */
  async documentExpiryAudit(asOf: Date = new Date()) {
    const rows = await this.vendorsRepository.documentsForExpirySweep(EXPIRING_DOCUMENT_KINDS);
    const vendors = buildExpiryQueue(
      rows.map((r) => ({ ...r, vendorPhone: r.vendorPhone ?? null, branchId: r.branchId ?? null })),
      asOf,
    );

    return {
      warningDays: EXPIRY_WARNING_DAYS,
      blockedCount: vendors.filter((v) => v.blockedFromNewWork).length,
      expiringSoonCount: vendors.filter((v) => !v.blockedFromNewWork).length,
      vendors,
    };
  }

  // ---- List / detail -----------------------------------------------

  async list(filters: VendorListFilters) {
    const rows = await this.vendorsRepository.list(filters);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      legalName: r.legalName,
      partyType: r.partyType,
      baseCity: r.baseCity,
      branchName: r.branchName,
      phone: r.phone,
      status: r.status,
      advancePct: r.advancePct,
      fleetCount: Number(r.fleetCount),
      rating: r.rating,
      trips: Number(r.trips),
      marginPaise: Number(r.marginPaise),
    }));
  }

  async getById(id: string) {
    const vendor = await this.vendorsRepository.findById(id);
    if (!vendor) {
      throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${id}`);
    }

    const [kycRows, docRows, fleetRows, advanceHistory, stats] = await Promise.all([
      this.vendorsRepository.findKyc(id),
      this.vendorsRepository.findDocuments(id),
      this.vendorsRepository.findFleet(id),
      this.vendorsRepository.findAdvanceHistory(id),
      this.vendorsRepository.findBusinessStats(id),
    ]);

    const kycByKind = new Map(kycRows.map((r) => [r.kind, r]));
    const kyc = KYC_KINDS.map((kind) => {
      const row = kycByKind.get(kind);
      return {
        kind,
        valueMasked: row?.value_masked ?? null,
        route: row?.route ?? null,
        status: row?.status ?? 'MISSING',
        verifiedBy: row?.verified_by ?? null,
        verifiedAt: row?.verified_at ?? null,
        rejectReason: row?.reject_reason ?? null,
        // Where the photo was taken — null for every upload from before the
        // geotag was persisted, and for kinds that never carry one.
        geo:
          row?.geoLat != null && row?.geoLng != null
            ? { lat: Number(row.geoLat), lng: Number(row.geoLng) }
            : null,
      };
    });

    const docsByKind = new Map(docRows.map((r) => [r.kind, r]));
    const documents = DOCUMENT_KINDS.map((kind) => {
      const row = docsByKind.get(kind);
      return {
        kind,
        reference: row?.reference ?? null,
        status: row?.status ?? 'MISSING',
        validTo: row?.valid_to ?? null,
        attachmentId: row?.attachment_id ?? null,
        rejectReason: row?.reject_reason ?? null,
      };
    });

    return {
      id: vendor.id,
      code: vendor.code,
      legalName: vendor.legal_name,
      partyType: vendor.party_type,
      gstin: vendor.gstin,
      pan: vendor.pan,
      phone: vendor.phone,
      altPhone: vendor.alt_phone,
      baseCity: vendor.base_city,
      branchId: vendor.branch_id,
      branchName: vendor.branchName,
      fleetBase: vendor.fleet_base,
      truckTypes: vendor.truck_types,
      operatingStates: vendor.operating_states,
      advancePct: vendor.advance_pct,
      bankAccount: vendor.bank_account ? `••${vendor.bank_account.slice(-4)}` : null,
      ifsc: vendor.ifsc,
      accountHolder: vendor.account_holder,
      status: vendor.status,
      verifiedBy: vendor.verified_by,
      panelDate: vendor.panel_date,
      rating: vendor.rating,
      source: vendor.source,
      // Onboarding's declared count (`declared_fleet_count`), not
      // `fleetRows.length` — `vendor_fleet` is a separate, not-yet-built
      // truck-registration table that nothing currently writes to, so a
      // row-count here would read 0 for every vendor regardless of what the
      // onboarding wizard collected. Matches `list()`'s same fix.
      fleetCount: vendor.declared_fleet_count,
      kyc,
      documents,
      advanceHistory: advanceHistory.map((h) => ({
        oldPct: h.oldPct,
        newPct: h.newPct,
        changedBy: h.changedByName,
        changedAt: h.changedAt,
        approvalId: h.approvalId,
      })),
      fleet: fleetRows.map((f) => ({
        registration: f.registration,
        type: f.type,
        // `FleetRow.capacityTn` (docs/api/02-vendors-compliance.md) — every
        // sibling module (trips/indents/reports) does this same kg→Tn
        // conversion at the response boundary; this one had drifted.
        capacityTn: f.capacity_kg / 1000,
        bodyType: f.body_type,
        currentCity: f.current_city,
        status: f.status,
      })),
      business: {
        trips: Number(stats.totals.trips),
        revenuePaise: Number(stats.totals.revenuePaise),
        marginPaise: Number(stats.totals.marginPaise),
        // Approximation until C6 (payments) exists: buy_rate less whatever has
        // already been released. Once advance/balance gates are real, this
        // repository query is the only place that needs to change.
        advanceOutstandingPaise: Math.max(0, Number(stats.totals.outstandingPaise)),
        balancePendingPaise: Math.max(0, Number(stats.totals.outstandingPaise)),
        penaltiesAccruedPaise: Number(stats.totals.penaltiesAccruedPaise),
        topLanes: stats.lanes.map((l) => ({
          lane: l.lane,
          trips: Number(l.trips),
          marginPct:
            Number(l.revenuePaise) > 0 ? Math.round((Number(l.marginPaise) / Number(l.revenuePaise)) * 1000) / 10 : 0,
        })),
      },
    };
  }

  // ---- Onboarding -----------------------------------------------------

  async create(dto: CreateVendorDto, actor: AuthenticatedUser) {
    const { branchId, overridden } = await this.deriveBranch(dto.baseCity, dto.branchId, dto.branchOverrideReason);

    let lead: { id: string; source: string | null; stage: string } | undefined;
    if (dto.leadId) {
      lead = await this.leadsRepository.findById(dto.leadId);
      if (!lead) throw new DomainException(404, 'NOT_FOUND', `Unknown lead: ${dto.leadId}`);
      if (lead.stage === 'CONVERTED') {
        throw new DomainException(409, 'LEAD_ALREADY_CONVERTED', 'This lead has already been converted to a vendor.');
      }
    }

    const row = await this.vendorsRepository.transaction().execute(async (trx) => {
      // BR-14/NFR-08: issued inside the transaction that creates the row, via
      // SELECT...FOR UPDATE on the series row — a rollback here never
      // consumes a VND- number.
      const code = await this.numberingService.issue(trx, 'VENDOR');
      const row = await this.vendorsRepository.insert(
        trx,
        {
          legalName: dto.legalName,
          partyType: dto.partyType,
          baseCity: dto.baseCity,
          branchId,
          phone: dto.phone,
          gstin: dto.gstin ?? null,
          altPhone: dto.altPhone ?? null,
          advancePct: dto.advancePct ?? 0,
          source: lead?.source ?? null,
        },
        code,
      );

      await this.auditService.record(trx, actor, {
        action: 'VENDOR_CREATED',
        entityType: 'vendors',
        entityId: row.id,
        after: { legalName: row.legal_name, branchId, branchOverridden: overridden, leadId: dto.leadId ?? null },
      });

      // Re-fetch FOR UPDATE inside this same transaction — the earlier
      // findById above was only to fail fast before doing any work.
      if (dto.leadId) {
        const leadForUpdate = await this.leadsRepository.findByIdForUpdate(trx, dto.leadId);
        if (!leadForUpdate) throw new DomainException(404, 'NOT_FOUND', `Unknown lead: ${dto.leadId}`);
        if (leadForUpdate.stage === 'CONVERTED') {
          throw new DomainException(409, 'LEAD_ALREADY_CONVERTED', 'This lead has already been converted to a vendor.');
        }
        await this.leadsRepository.updateInTransaction(trx, dto.leadId, {
          stage: 'CONVERTED',
          converted_vendor_id: row.id,
        });
      }

      return row;
    });

    // Returned camelCase, same shape as GET /vendors/:id — not the raw
    // snake_case insert row (00-conventions.md §5: the API layer never
    // exposes a database identifier as-is).
    return this.getById(row.id);
  }

  async update(
    id: string,
    dto: UpdateVendorDto,
    actor: AuthenticatedUser,
  ): Promise<ApprovalRequiredResponse | ReturnType<VendorsService['getById']>> {
    // BR-47: a branch reassignment on a vendor whose file has already been
    // decided (anything past PENDING_VERIFICATION) is the heavier "override"
    // action `deriveBranch`'s doc comment describes, not the draft-stage
    // direct write below — it has to go through the approval engine instead
    // of writing branch_id straight to the row. Checked and (when it fires)
    // raised BEFORE the update transaction opens, mirroring
    // `patchAdvancePolicy`: a plain, non-locking read decides whether this
    // request turns into an approval instead of a write, and if it does, the
    // whole request is deferred — not just the branch_id field — the same
    // all-or-nothing shape as the ADVANCE_POLICY_CHANGE gate below.
    if (dto.branchId || dto.baseCity) {
      const preCheck = await this.vendorsRepository.findById(id);
      if (!preCheck) {
        throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${id}`);
      }
      const NOT_YET_DECIDED_STATUSES = new Set(['DRAFT', 'PENDING_VERIFICATION']);
      if (!NOT_YET_DECIDED_STATUSES.has(preCheck.status)) {
        const derived = await this.deriveBranch(
          dto.baseCity ?? preCheck.base_city,
          dto.branchId,
          dto.branchOverrideReason,
        );
        if (derived.branchId !== preCheck.branch_id) {
          const action: BranchOverrideAction = { vendorId: id, branchId: derived.branchId };
          return this.approvalsService.raise(
            {
              kind: 'BRANCH_OVERRIDE',
              entityType: 'vendors',
              entityId: id,
              reason: dto.branchOverrideReason ?? '',
              title: `Branch override · ${preCheck.legal_name}`,
              detail: `${preCheck.branchName ?? preCheck.branch_id} → ${derived.branchId}`,
              amountPaise: null,
              action,
            },
            actor,
          );
        }
      }
    }

    await this.vendorsRepository.transaction().execute(async (trx) => {
      const existing = await this.vendorsRepository.findByIdForUpdate(trx, id);
      if (!existing) {
        throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${id}`);
      }

      // BR-57. This message is rendered to an operator as-is, so it must not
      // name a rule code or an HTTP route — it says what to do instead.
      if (dto.advancePct !== undefined && existing.status === 'ACTIVE') {
        throw new DomainException(
          409,
          'ADVANCE_POLICY_CHANGE_REQUIRED',
          "Once a vendor is active, their advance policy has to be changed from the vendor's own page — the change is sent for approval before it applies.",
        );
      }

      let branchId = existing.branch_id;
      if (dto.branchId || dto.baseCity) {
        const derived = await this.deriveBranch(
          dto.baseCity ?? existing.base_city,
          dto.branchId,
          dto.branchOverrideReason,
        );
        branchId = derived.branchId;
      }

      const patch: Record<string, unknown> = { branch_id: branchId };
      if (dto.legalName !== undefined) patch.legal_name = dto.legalName;
      if (dto.partyType !== undefined) patch.party_type = dto.partyType;
      if (dto.baseCity !== undefined) patch.base_city = dto.baseCity;
      if (dto.phone !== undefined) patch.phone = dto.phone;
      if (dto.gstin !== undefined) patch.gstin = dto.gstin;
      if (dto.altPhone !== undefined) patch.alt_phone = dto.altPhone;
      if (dto.fleetBase !== undefined) patch.fleet_base = dto.fleetBase;
      if (dto.fleetCount !== undefined) patch.declared_fleet_count = dto.fleetCount;
      if (dto.truckTypes !== undefined) patch.truck_types = dto.truckTypes;
      if (dto.bodyType !== undefined) patch.fleet_body_type = dto.bodyType;
      if (dto.operatingStates !== undefined) patch.operating_states = dto.operatingStates;
      if (dto.bankAccount !== undefined) patch.bank_account = dto.bankAccount;
      if (dto.ifsc !== undefined) patch.ifsc = dto.ifsc;
      if (dto.accountHolder !== undefined) patch.account_holder = dto.accountHolder;
      if (dto.advancePct !== undefined) patch.advance_pct = dto.advancePct;
      if (dto.source !== undefined) patch.source = dto.source;
      if (dto.panelDate !== undefined) patch.panel_date = dto.panelDate;

      await this.vendorsRepository.update(trx, id, patch);
      await this.auditService.record(trx, actor, {
        action: 'VENDOR_UPDATED',
        entityType: 'vendors',
        entityId: id,
        after: patch,
      });
    });

    // Camelcase, same shape as GET /vendors/:id — see create() above.
    return this.getById(id);
  }

  // ---- KYC --------------------------------------------------------------

  async submitKyc(vendorId: string, kind: string, dto: SubmitKycDto, actor: AuthenticatedUser) {
    this.assertKnownKind(kind, KYC_KINDS as readonly string[], 'kyc');
    await this.assertVendorExists(vendorId);

    const valueMasked = kind === 'AADHAAR' && dto.value ? dto.value.slice(-4) : (dto.value ?? null);

    return this.vendorsRepository.transaction().execute(async (trx) => {
      const row = await this.vendorsRepository.upsertKyc(trx, {
        vendorId,
        kind,
        valueMasked,
        route: dto.route,
        attachmentId: dto.attachmentId ?? null,
      });
      await this.auditService.record(trx, actor, {
        action: 'VENDOR_KYC_SUBMITTED',
        entityType: 'vendor_kyc',
        entityId: row.id,
        after: { vendorId, kind, route: dto.route },
      });
      return { kind: row.kind, status: row.status, route: row.route };
    });
  }

  async verifyKyc(vendorId: string, kind: string, approve: boolean, reason: string | undefined, actor: AuthenticatedUser) {
    this.assertKnownKind(kind, KYC_KINDS as readonly string[], 'kyc');
    if (!approve) assertReason(reason);

    return this.vendorsRepository.transaction().execute(async (trx) => {
      const existing = await this.vendorsRepository.findKycOne(trx, vendorId, kind);
      if (!existing) {
        throw new DomainException(404, 'NOT_FOUND', `${kind} has not been submitted for vendor ${vendorId}.`);
      }
      const row = await this.vendorsRepository.decideKyc(
        trx,
        vendorId,
        kind,
        approve ? 'VERIFIED' : 'REJECTED',
        actor.userId,
        approve ? null : (reason ?? null),
      );
      await this.auditService.record(trx, actor, {
        action: 'VENDOR_KYC_VERIFIED',
        entityType: 'vendor_kyc',
        entityId: row.id,
        before: { status: existing.status },
        after: { status: row.status, reason: approve ? undefined : reason },
      });
      return { kind: row.kind, status: row.status };
    });
  }

  // ---- KYC value backfill (PAN/AADHAAR captured photo-only, pre-fix) ----

  /**
   * `GET /vendors/kyc-backfill-queue` — every PAN/AADHAAR row with a photo
   * on file but no extracted value, left behind by the onboarding wizard's
   * `needsReference: false` bug (fixed 2026-08-26). Compliance works this
   * list by opening each photo and typing what it actually says.
   */
  async kycBackfillQueue() {
    const rows = await this.vendorsRepository.findKycValueGaps();
    return rows.map((r) => ({
      vendorId: r.vendorId,
      vendorCode: r.vendorCode,
      vendorName: r.vendorName,
      kind: r.kind,
      attachmentId: r.attachmentId,
      status: r.status,
    }));
  }

  /**
   * `PATCH /vendors/:id/kyc/:kind/value` — records the value read off an
   * already-captured photo. Deliberately not `submitKyc`: that upserts and
   * resets verification to PENDING on every call (BR-31 — a re-upload must
   * not carry forward a stale verification), which is correct for a real
   * re-upload but wrong here — the photo hasn't changed, only the typed
   * value catching up to it, so an already-VERIFIED row stays VERIFIED.
   */
  async backfillKycValue(vendorId: string, kind: string, dto: BackfillKycValueDto, actor: AuthenticatedUser) {
    if (kind !== 'PAN' && kind !== 'AADHAAR') {
      throw new DomainException(400, 'VALIDATION_ERROR', 'Only PAN and AADHAAR values can be backfilled.');
    }

    const valueMasked = kind === 'AADHAAR' ? dto.value.replace(/\D/g, '').slice(-4) : dto.value.trim().toUpperCase();
    const re = kind === 'AADHAAR' ? AADHAAR_LAST4_RE : PAN_RE;
    if (!re.test(valueMasked)) {
      throw new DomainException(400, 'VALIDATION_ERROR', kind === 'AADHAAR' ? FORMAT_MESSAGE.aadhaar : FORMAT_MESSAGE.pan);
    }

    return this.vendorsRepository.transaction().execute(async (trx) => {
      const updated = await this.vendorsRepository.backfillKycValue(trx, vendorId, kind, valueMasked);
      if (!updated) {
        throw new DomainException(
          409,
          'ALREADY_BACKFILLED',
          `${kind} already has a value on file, or does not have a photo to back-fill from.`,
        );
      }

      await this.auditService.record(trx, actor, {
        action: 'VENDOR_KYC_VALUE_BACKFILLED',
        entityType: 'vendor_kyc',
        entityId: vendorId,
        after: { kind },
      });
      return { kind, valueMasked };
    });
  }

  // ---- Documents ----------------------------------------------------

  async submitDocument(vendorId: string, kind: string, dto: SubmitDocumentDto, actor: AuthenticatedUser) {
    this.assertKnownKind(kind, DOCUMENT_KINDS as readonly string[], 'document');
    await this.assertVendorExists(vendorId);

    return this.vendorsRepository.transaction().execute(async (trx) => {
      const row = await this.vendorsRepository.upsertDocument(trx, {
        vendorId,
        kind,
        attachmentId: dto.attachmentId,
        reference: dto.reference ?? null,
        validFrom: dto.validFrom ?? null,
        validTo: dto.validTo ?? null,
      });
      await this.auditService.record(trx, actor, {
        action: 'VENDOR_DOCUMENT_SUBMITTED',
        entityType: 'vendor_documents',
        entityId: row.id,
        after: { vendorId, kind },
      });
      return { kind: row.kind, status: row.status };
    });
  }

  async verifyDocument(
    vendorId: string,
    kind: string,
    approve: boolean,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ) {
    this.assertKnownKind(kind, DOCUMENT_KINDS as readonly string[], 'document');
    if (!approve) assertReason(reason);

    return this.vendorsRepository.transaction().execute(async (trx) => {
      const existing = await this.vendorsRepository.findDocumentOne(trx, vendorId, kind);
      if (!existing) {
        throw new DomainException(404, 'NOT_FOUND', `${kind} has not been uploaded for vendor ${vendorId}.`);
      }
      const row = await this.vendorsRepository.decideDocument(
        trx,
        vendorId,
        kind,
        approve ? 'VERIFIED' : 'REJECTED',
        actor.userId,
        approve ? null : (reason ?? null),
      );
      await this.auditService.record(trx, actor, {
        action: 'VENDOR_DOCUMENT_VERIFIED',
        entityType: 'vendor_documents',
        entityId: row.id,
        before: { status: existing.status },
        after: { status: row.status, reason: approve ? undefined : reason },
      });
      return { kind: row.kind, status: row.status };
    });
  }

  // ---- Submit / activate ------------------------------------------------

  async submit(vendorId: string, actor: AuthenticatedUser) {
    return this.vendorsRepository.transaction().execute(async (trx) => {
      const vendor = await this.vendorsRepository.findByIdForUpdate(trx, vendorId);
      if (!vendor) throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${vendorId}`);

      const kycRows = await this.vendorsRepository.findKyc(vendorId);
      const docRows = await this.vendorsRepository.findDocuments(vendorId);
      const unmet = this.unmetForSubmit(vendor.party_type, kycRows, docRows, 'exists');
      if (unmet.length > 0) {
        throw new DomainException(409, 'VENDOR_INCOMPLETE', 'This vendor file is incomplete.', { unmet });
      }

      const row = await this.vendorsRepository.update(trx, vendorId, { status: 'PENDING_VERIFICATION' });
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'vendors',
        entityId: vendorId,
        before: { status: vendor.status },
        after: { status: row.status },
      });
      return { id: row.id, status: row.status };
    });
  }

  async activate(vendorId: string, actor: AuthenticatedUser) {
    const result = await this.vendorsRepository.transaction().execute(async (trx) => {
      const vendor = await this.vendorsRepository.findByIdForUpdate(trx, vendorId);
      if (!vendor) throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${vendorId}`);

      const kycRows = await this.vendorsRepository.findKyc(vendorId);
      const docRows = await this.vendorsRepository.findDocuments(vendorId);
      // BR-01: every mandatory item must be VERIFIED, not merely present.
      const unmet = this.unmetForSubmit(vendor.party_type, kycRows, docRows, 'verified');
      if (unmet.length > 0) {
        throw new DomainException(409, 'VENDOR_INCOMPLETE', 'This vendor file is not fully verified.', { unmet });
      }

      const row = await this.vendorsRepository.update(trx, vendorId, {
        status: 'ACTIVE',
        verified_by: actor.userId,
      });
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'vendors',
        entityId: vendorId,
        before: { status: vendor.status },
        after: { status: row.status },
      });
      return row;
    });

    const provisioning = await this.portalAccountService.provision(result.id, result.phone);
    return { id: result.id, status: result.status, portalAccountProvisioned: provisioning.provisioned };
  }

  // ---- On hold / off hold ----------------------------------------------
  //
  // What SUSPENDED already means elsewhere, none of it new here: the award
  // gate refuses anything but ACTIVE (BR-01, `indents.service.ts`), the
  // transporter portal drops to read-only (`portal-write.guard.ts`) while
  // still letting them see their running trips
  // (`PORTAL_READABLE_VENDOR_STATUSES`). Trips already moving are not
  // touched — the same reasoning as the document-expiry sweep: a hold stops
  // *new* work, it does not strand a loaded truck.

  async suspend(vendorId: string, reason: string, actor: AuthenticatedUser) {
    assertReason(reason);
    return this.vendorsRepository.transaction().execute(async (trx) => {
      const vendor = await this.vendorsRepository.findByIdForUpdate(trx, vendorId);
      if (!vendor) throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${vendorId}`);
      if (vendor.status !== 'ACTIVE') {
        throw new DomainException(
          409,
          'VENDOR_NOT_ACTIVE',
          'Only an active transporter can be put on hold — this one is not active.',
        );
      }
      const row = await this.vendorsRepository.update(trx, vendorId, { status: 'SUSPENDED' });
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'vendors',
        entityId: vendorId,
        before: { status: vendor.status },
        after: { status: row.status, reason },
      });
      return { id: row.id, status: row.status };
    });
  }

  /**
   * Back to ACTIVE with the original clearance intact — `verified_by` is not
   * rewritten, because the paperwork was never un-verified; only the desk's
   * willingness to give them loads was withdrawn. A hold on a vendor whose
   * papers have since lapsed still comes back ACTIVE here, and the expiry
   * gate at award keeps refusing them until the paper is renewed.
   */
  async reinstate(vendorId: string, actor: AuthenticatedUser) {
    return this.vendorsRepository.transaction().execute(async (trx) => {
      const vendor = await this.vendorsRepository.findByIdForUpdate(trx, vendorId);
      if (!vendor) throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${vendorId}`);
      if (vendor.status !== 'SUSPENDED') {
        throw new DomainException(
          409,
          'VENDOR_NOT_ON_HOLD',
          'This transporter is not on hold, so there is nothing to take them off.',
        );
      }
      const row = await this.vendorsRepository.update(trx, vendorId, { status: 'ACTIVE' });
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'vendors',
        entityId: vendorId,
        before: { status: vendor.status },
        after: { status: row.status },
      });
      return { id: row.id, status: row.status };
    });
  }

  // ---- Advance policy -----------------------------------------------

  async patchAdvancePolicy(
    vendorId: string,
    dto: AdvancePolicyDto,
    actor: AuthenticatedUser,
  ): Promise<ApprovalRequiredResponse> {
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${vendorId}`);

    const action: AdvancePolicyChangeAction = { vendorId, newPct: dto.advancePct };
    return this.approvalsService.raise(
      {
        kind: 'ADVANCE_POLICY_CHANGE',
        entityType: 'vendors',
        entityId: vendorId,
        reason: dto.reason,
        title: `Advance policy change · ${vendor.legal_name}`,
        detail: `${vendor.advance_pct}% → ${dto.advancePct}%`,
        amountPaise: null,
        action,
      },
      actor,
    );
  }

  // ---- Helpers ------------------------------------------------------

  private assertKnownKind(kind: string, known: readonly string[], label: string) {
    if (!known.includes(kind)) {
      throw new DomainException(400, 'VALIDATION_ERROR', `Unknown ${label} kind: ${kind}.`);
    }
  }

  private async assertVendorExists(vendorId: string) {
    const vendor = await this.vendorsRepository.findById(vendorId);
    if (!vendor) throw new DomainException(404, 'NOT_FOUND', `Unknown vendor: ${vendorId}`);
    return vendor;
  }

  /**
   * BR-02/BR-03 at `mode: 'exists'` (submit — has it been uploaded), BR-01 at
   * `mode: 'verified'` (activate — has compliance signed off on it).
   */
  private unmetForSubmit(
    partyType: string,
    kycRows: Array<{ kind: string; status: string }>,
    docRows: Array<{ kind: string; status: string }>,
    mode: 'exists' | 'verified',
  ): UnmetItem[] {
    const unmet: UnmetItem[] = [];
    const kycByKind = new Map(kycRows.map((r) => [r.kind, r.status]));
    const docByKind = new Map(docRows.map((r) => [r.kind, r.status]));

    const passes = (status: string | undefined) =>
      mode === 'exists' ? status !== undefined : status === 'VERIFIED';
    const stateFor = (status: string | undefined): UnmetItem['state'] =>
      status === undefined ? 'MISSING' : status === 'REJECTED' ? 'REJECTED' : 'UNVERIFIED';

    for (const kind of MANDATORY_KYC_KINDS) {
      const status = kycByKind.get(kind);
      if (!passes(status)) {
        unmet.push({ key: `KYC_${kind}`, label: `${kind} not verified`, state: stateFor(status) });
      }
    }

    for (const kind of ALWAYS_MANDATORY_DOCUMENT_KINDS) {
      const status = docByKind.get(kind);
      if (!passes(status)) {
        unmet.push({ key: `DOC_${kind}`, label: `${kind.replace(/_/g, ' ')} not verified`, state: stateFor(status) });
      }
    }

    if (partyType === 'OWNER') {
      // BR-02: RC mandatory for an Owner.
      const status = docByKind.get('RC');
      if (!passes(status)) {
        unmet.push({ key: 'DOC_RC', label: 'RC not verified', state: stateFor(status) });
      }
    } else {
      // BR-02: else at least one legal document.
      const anyPasses = LEGAL_DOCUMENT_KINDS.some((k) => passes(docByKind.get(k)));
      if (!anyPasses) {
        unmet.push({
          key: 'DOC_LEGAL',
          label: 'No legal document (trade licence, labour licence, RC or Udyam) verified',
          state: 'MISSING',
        });
      }
    }

    return unmet;
  }

  /**
   * BR-34: derive the branch within the 150km catchment. No geocoding service
   * is configured anywhere in this system's env contract (part 14 §9 names
   * none) — `vendors.base_city` is free text, not coordinates, so a real
   * haversine catchment check isn't computable here. Simplified, flagged
   * deliberately: match `base_city` to a branch's `city` case-insensitively.
   * Exactly one match → derived silently. Zero or several, or an explicit
   * `branchId` that disagrees with the single match → the caller must supply
   * `branchId` and, if it's a genuine override, a `branchOverrideReason`
   * (≥20 chars) that gets audited (BR-47). A real distance check belongs here
   * once a geocoding provider is chosen — this is the one function that would
   * change.
   */
  private async deriveBranch(
    baseCity: string,
    explicitBranchId: string | undefined,
    overrideReason: string | undefined,
  ): Promise<{ branchId: string; overridden: boolean }> {
    const matches = await this.vendorsRepository.findBranchByCity(baseCity);

    if (!explicitBranchId) {
      if (matches.length === 1) {
        return { branchId: matches[0].id, overridden: false };
      }
      throw new DomainException(
        422,
        'BRANCH_REQUIRED',
        matches.length === 0
          ? `No branch matches city "${baseCity}". Supply branchId explicitly.`
          : `${matches.length} branches match city "${baseCity}". Supply branchId explicitly.`,
      );
    }

    const isTheSingleMatch = matches.length === 1 && matches[0].id === explicitBranchId;
    if (!isTheSingleMatch) {
      // BR-47: an override — reason mandatory and recorded (audited by the caller).
      assertReason(overrideReason);
    }
    return { branchId: explicitBranchId, overridden: !isTheSingleMatch };
  }
}
