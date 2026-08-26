import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DomainException, assertReason } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import type { ApprovalRequiredResponse } from '../../common/approval-required.response';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { ApprovalsService } from '../approvals/approvals.service';
import { ApprovalsRegistry } from '../approvals/approvals.registry';
import { OrdersService } from '../orders/orders.service';
import { VendorsRepository } from '../vendors/vendors.repository';
import { canRaiseIndent, indentBlockReason } from '../clients/client-onboarding';
import { awardBlockReason, vendorExpiryReport } from '../vendors/vendor-document-expiry';
import { crossCheckRate } from './rate-cross-check';
import { IndentsRepository, type IndentListFilters } from './indents.repository';
import type { CreateIndentDto } from './dto/create-indent.dto';
import type { PlacementDto } from './dto/placement.dto';

interface AwardAction {
  indentId: string;
  quoteId: string;
}

interface IndentAdvancePctAction {
  indentId: string;
  newPct: number;
}

@Injectable()
export class IndentsService implements OnModuleInit {
  constructor(
    private readonly indentsRepository: IndentsRepository,
    private readonly vendorsRepository: VendorsRepository,
    private readonly auditService: AuditService,
    private readonly numberingService: NumberingService,
    private readonly approvalsService: ApprovalsService,
    private readonly approvalsRegistry: ApprovalsRegistry,
    private readonly ordersService: OrdersService,
  ) {}

  private readonly logger = new Logger('IndentsService');

  /**
   * Opens the order for a freshly created indent — step 1 of the ten.
   *
   * After commit, not inside the transaction: `createForIndent` opens its own
   * transaction internally, so nesting it here would not behave. The upside of
   * that ordering is that the ORD- number is only consumed once the indent is
   * genuinely real, so a rolled-back creation burns nothing.
   *
   * The risk runs the other way — an indent that commits and then fails to get
   * an order — which `OrdersService.reconcile()` repairs. Non-fatal for the
   * same reason: the indent exists, and refusing the request over a missing
   * derived row would be the worse bug.
   */
  private async openOrder(indentId: string, actor: AuthenticatedUser | null) {
    try {
      await this.ordersService.createForIndent(indentId, actor);
    } catch (e) {
      this.logger.error(
        `Order creation failed for indent ${indentId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Moves the ladder after an indent transition has COMMITTED. */
  private async syncOrder(indentId: string, actor: AuthenticatedUser | null, note: string | null = null) {
    try {
      await this.ordersService.recompute(indentId, actor, note);
    } catch (e) {
      this.logger.error(
        `Order recompute failed for indent ${indentId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  onModuleInit() {
    // D-39: above-band quotes are kept and shown, never refused — this is
    // what fires when leadership clears one. Replays applyAward verbatim.
    this.approvalsRegistry.register('ABOVE_BAND_PRICE', 'indents', async (action: AwardAction, ctx) => {
      // ctx.db is ApprovalsService.approve()'s own transaction — see the
      // deadlock/atomicity note on ApprovalHandler (approvals.types.ts).
      await this.applyAward(ctx.db, action.indentId, action.quoteId, {
        userId: ctx.approverId,
        role: ctx.approverRole,
      });
    });

    // BR-57 indent half (D-22): a one-off departure from the awarded vendor's
    // standing policy, scoped to this indent only — never touches
    // vendors.advance_pct or vendor_advance_history (vendors.service.ts's
    // handler, registered under entityType 'vendors', owns that).
    this.approvalsRegistry.register('ADVANCE_POLICY_CHANGE', 'indents', async (action: IndentAdvancePctAction, ctx) => {
      const indent = await this.indentsRepository.findByIdForUpdate(ctx.db, action.indentId);
      if (!indent) throw new DomainException(409, 'INDENT_NOT_FOUND', `Indent ${action.indentId} no longer exists.`);
      await this.indentsRepository.update(ctx.db, action.indentId, { advance_pct: action.newPct });
    });
  }

  async list(filters: IndentListFilters) {
    const rows = await this.indentsRepository.list(filters);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      clientName: r.clientName,
      lane: `${r.fromCity} → ${r.toCity}`,
      material: r.material,
      weightTn: r.weightKg / 1000,
      truckType: r.truckType,
      pickupDate: r.pickupDate,
      sellRatePaise: r.sellRatePaise,
      buyRatePaise: r.buyRatePaise,
      quoteCount: Number(r.quoteCount),
      stage: r.stage,
      branchName: r.branchName,
      failureCause: r.failureCause,
    }));
  }

  async getById(id: string) {
    const indent = await this.indentsRepository.findById(id);
    if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${id}`);

    const quotes = await this.indentsRepository.findQuotes(id);

    return {
      id: indent.id,
      code: indent.code,
      clientId: indent.client_id,
      // Joined in `findById`. Without these the detail header rendered blank
      // Client and Branch on the real API; `awardedQuoteId` is what draws the
      // "Awarded" tag on the winning bid.
      clientName: indent.clientName,
      branchName: indent.branchName,
      awardedQuoteId: indent.awarded_quote_id,
      branchId: indent.branch_id,
      fromCity: indent.from_city,
      toCity: indent.to_city,
      material: indent.material,
      weightTn: indent.weight_kg / 1000,
      truckType: indent.truck_type,
      pickupDate: indent.pickup_date,
      stage: indent.stage,
      rateSource: indent.rate_source,
      sellRatePaise: indent.sell_rate,
      buyRatePaise: indent.buy_rate,
      sourcingRatePaise: indent.sourcing_rate,
      spotConfirmationAttachmentId: indent.spot_confirmation_attachment_id,
      rateCardLaneId: indent.rate_card_lane_id,
      bidMinPaise: indent.bid_min,
      bidMaxPaise: indent.bid_max,
      bandLocked: indent.band_locked,
      advancePct: indent.advance_pct,
      transitDays: indent.transit_days,
      reportingRule: indent.reporting_rule,
      remarks: indent.remarks,
      vendorId: indent.vendor_id,
      vehicleNo: indent.vehicle_no,
      driverName: indent.driver_name,
      driverLicence: indent.driver_licence,
      reportedAt: indent.reported_at,
      failureCause: indent.failure_cause,
      quotes: quotes.map((q) => ({
        id: q.id,
        code: q.code,
        vendorId: q.vendorId,
        vendorName: q.vendorName,
        vendorStatus: q.vendorStatus,
        amountPaise: q.amountPaise,
        truckRegistration: q.truckRegistration,
        bandPosition: q.bandPosition,
        status: q.status,
        submittedAt: q.submittedAt,
        remarks: q.remarks,
      })),
    };
  }

  async create(dto: CreateIndentDto, actor: AuthenticatedUser) {
    // BR-26: a spot indent cannot exist without the client's written rate confirmation.
    if (dto.rateSource === 'SPOT' && !dto.spotConfirmationAttachmentId) {
      throw new DomainException(400, 'SPOT_CONFIRMATION_REQUIRED', 'A spot indent needs the rate confirmation attachment.');
    }
    // BR-38: spot freight is never quoted at or below the sourcing rate.
    if (dto.rateSource === 'SPOT' && (!dto.sourcingRatePaise || dto.sellRatePaise <= dto.sourcingRatePaise)) {
      throw new DomainException(400, 'SPOT_BELOW_SOURCING', 'Spot freight must exceed the sourcing rate.');
    }
    if (dto.bidMinPaise && dto.bidMaxPaise && dto.bidMaxPaise < dto.bidMinPaise) {
      throw new DomainException(400, 'VALIDATION_ERROR', 'bidMaxPaise must be ≥ bidMinPaise.');
    }

    /*
     * The client has to have been cleared by Compliance first.
     *
     * This is what makes client onboarding mean something. Without it the
     * pipeline would be a form somebody fills in while work carries on
     * regardless — which is exactly what happened before it existed: a client
     * was created straight to ACTIVE and nothing ever checked. It mirrors the
     * rule on the supply side, where a transporter cannot be given loads
     * until their documents are cleared.
     *
     * The reason comes from `indentBlockReason`, so the operator is told
     * which of the four not-active states they have hit and what would move
     * it — "not active" on its own is a dead end.
     */
    const client = await this.indentsRepository.findClientStatus(dto.clientId);
    if (!client) {
      throw new DomainException(404, 'CLIENT_NOT_FOUND', 'That client does not exist.');
    }
    /*
     * Rate cross-verification: does this price match what we agreed?
     *
     * Nothing checked this before. An indent stored `rate_card_lane_id` and
     * `sell_rate` next to each other and never compared them, so a contract
     * load could be raised at any price against a lane that said something
     * else — or against another client's lane, or one that expired months
     * ago. The loss is quiet: an under-priced contract load bills less than
     * the contract entitles us to, and no report would ever surface it.
     *
     * Only runs when a lane is actually named. A contract client moving on a
     * route their rate card does not cover is legitimate; it just has no
     * agreed price to be checked against.
     */
    if (dto.rateCardLaneId) {
      const lane = await this.indentsRepository.findRateCardLane(dto.rateCardLaneId);
      if (!lane) {
        throw new DomainException(404, 'RATE_CARD_LANE_NOT_FOUND', 'That rate card lane does not exist.');
      }
      const check = crossCheckRate(
        {
          clientId: dto.clientId,
          fromCity: dto.fromCity,
          toCity: dto.toCity,
          truckType: dto.truckType,
          sellRatePaise: dto.sellRatePaise,
          pickupDate: dto.pickupDate,
        },
        lane,
      );
      if (!check.ok) {
        throw new DomainException(409, 'RATE_CROSS_CHECK_FAILED', check.reason ?? 'Rate does not match the rate card.', {
          mismatch: check.mismatch,
          agreedRatePaise: check.agreedRatePaise ?? null,
          quotedRatePaise: dto.sellRatePaise,
        });
      }
    }

    if (!canRaiseIndent(client.status)) {
      throw new DomainException(
        422,
        'CLIENT_NOT_CLEARED',
        indentBlockReason(client.status) ?? 'This client has not been cleared for work.',
      );
    }

    // BR-20: branch derived from the pickup city, carried unchanged to the
    // trip and the LR. Same flagged simplification as vendors.service.ts's
    // deriveBranch — no geocoding provider is configured anywhere in this
    // system, so this matches by exact city name rather than a 150km radius.
    const matches = await this.indentsRepository.findBranchByCity(dto.fromCity);
    if (matches.length !== 1) {
      throw new DomainException(
        422,
        'BRANCH_REQUIRED',
        `Cannot derive a branch from pickup city "${dto.fromCity}" (${matches.length} matches).`,
      );
    }

    const row = await this.indentsRepository.transaction().execute(async (trx) => {
      const code = await this.numberingService.issue(trx, 'INDENT');
      const inserted = await this.indentsRepository.insert(trx, code, {
        client_id: dto.clientId,
        branch_id: matches[0].id,
        from_city: dto.fromCity,
        to_city: dto.toCity,
        material: dto.material,
        weight_kg: Math.round(dto.weightTn * 1000),
        truck_type: dto.truckType,
        pickup_date: dto.pickupDate,
        transit_days: dto.transitDays ?? null,
        reporting_rule: dto.reportingRule ?? null,
        remarks: dto.remarks ?? null,
        rate_source: dto.rateSource,
        sell_rate: dto.sellRatePaise,
        sourcing_rate: dto.sourcingRatePaise ?? null,
        spot_confirmation_attachment_id: dto.spotConfirmationAttachmentId ?? null,
        rate_card_lane_id: dto.rateCardLaneId ?? null,
        bid_min: dto.bidMinPaise ?? null,
        bid_max: dto.bidMaxPaise ?? null,
        // BR-39: the band locks the moment the indent is published — from
        // creation, not from the first quote, or the tempting window (no
        // quote yet) would be exactly the one left open.
        band_locked: Boolean(dto.bidMinPaise || dto.bidMaxPaise),
        advance_pct: dto.advancePct ?? 0,
      });
      await this.auditService.record(trx, actor, {
        action: 'INDENT_CREATED',
        entityType: 'indents',
        entityId: inserted.id,
        after: { code: inserted.code, branchId: matches[0].id },
      });
      return inserted;
    });

    // Step 1, "Indent created" — opens the order and issues its ORD- number.
    await this.openOrder(row.id, actor);
    return this.getById(row.id);
  }

  async award(
    indentId: string,
    quoteId: string,
    reason: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<ApprovalRequiredResponse | ReturnType<IndentsService['getById']>> {
    // A non-locking preview, only to choose direct vs. approval path.
    // `applyAward` re-reads the quote under `FOR UPDATE` inside the real
    // transaction and is the actual authority on its status and band.
    const preview = (await this.indentsRepository.findQuotes(indentId)).find((q) => q.id === quoteId);
    if (!preview) throw new DomainException(404, 'NOT_FOUND', `Unknown quote: ${quoteId}`);

    if (preview.bandPosition === 'ABOVE_BAND') {
      const indent = await this.indentsRepository.findById(indentId);
      return this.approvalsService.raise(
        {
          kind: 'ABOVE_BAND_PRICE',
          entityType: 'indents',
          entityId: indentId,
          reason: reason && reason.length >= 20 ? reason : 'Above-band award requested at the desk.',
          title: `Award at ${preview.amountPaise} paise · above band`,
          detail: `${indent?.from_city} → ${indent?.to_city}. Quote ${preview.code} from ${preview.vendorName}.`,
          amountPaise: preview.amountPaise,
          action: { indentId, quoteId } satisfies AwardAction,
        },
        actor,
      );
    }

    await this.indentsRepository.transaction().execute(async (trx) => {
      await this.applyAward(trx, indentId, quoteId, actor);
    });
    return this.getById(indentId);
  }

  /**
   * Shared by the direct (in-band) award path and the `ABOVE_BAND_PRICE`
   * replay handler. `approver` only needs `userId`/`role` — the direct path
   * passes the full acting user, the replay path passes the approver.
   */
  private async applyAward(
    trx: Parameters<IndentsRepository['findByIdForUpdate']>[0],
    indentId: string,
    quoteId: string,
    approver: Pick<AuthenticatedUser, 'userId' | 'role'>,
  ) {
    const indent = await this.indentsRepository.findByIdForUpdate(trx, indentId);
    if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);

    const quote = await this.indentsRepository.findQuoteForUpdate(trx, quoteId);
    if (!quote || quote.indent_id !== indentId) {
      throw new DomainException(404, 'NOT_FOUND', `Unknown quote ${quoteId} on indent ${indentId}.`);
    }
    if (quote.status !== 'SUBMITTED') {
      throw new DomainException(409, 'QUOTE_NOT_AWARDABLE', `Quote ${quoteId} is already ${quote.status}.`);
    }

    // BR-01: a quote from a non-ACTIVE vendor cannot be awarded.
    const vendor = await this.vendorsRepository.findById(quote.vendor_id);
    if (!vendor || vendor.status !== 'ACTIVE') {
      throw new DomainException(409, 'VENDOR_NOT_ACTIVE', 'This vendor is not active.', {
        unmet: [{ key: 'VENDOR_STATUS', label: `Vendor status is ${vendor?.status ?? 'unknown'}`, state: 'BLOCKED' }],
      });
    }

    /*
     * ...and nor can one whose legal papers have since lapsed.
     *
     * `status === 'ACTIVE'` was the whole of the check, and it is a statement
     * about the past: it records that Compliance cleared this vendor once.
     * `vendor_documents.valid_to` has been captured and displayed since the
     * first migration and read by nothing, so a trade licence that expired a
     * year ago left the vendor ACTIVE and awardable. The exposure is not a
     * wrong number on a screen — it is goods moving on a vehicle whose
     * paperwork we are asserting we checked.
     *
     * Deliberately blocks only *new* work. Nothing here suspends the vendor
     * or touches trips already running: a certificate lapsing overnight must
     * not strand a load mid-route, and suspending is Compliance's decision to
     * take, not a side effect of awarding.
     */
    // `findDocuments` is a `selectAll()`, so the rows are snake_case.
    const vendorDocs = await this.vendorsRepository.findDocuments(quote.vendor_id);
    const expiry = vendorExpiryReport(
      vendorDocs.map((d) => ({ kind: d.kind, status: d.status, validTo: d.valid_to ?? null })),
      new Date(),
    );
    if (expiry.hasExpired) {
      throw new DomainException(
        409,
        'VENDOR_DOCUMENTS_EXPIRED',
        awardBlockReason(vendor.status, expiry) ?? 'This transporter has expired documents.',
        {
          unmet: expiry.expired.map((e) => ({
            key: e.kind,
            label: `${e.kind.replace(/_/g, ' ')} expired ${e.validTo}`,
            state: 'BLOCKED',
          })),
        },
      );
    }

    await this.indentsRepository.decideQuote(trx, quoteId, 'ACCEPTED');
    await this.indentsRepository.rejectOtherSubmittedQuotes(trx, indentId, quoteId);

    // BR-06: the buy rate is written at the moment of the decision and never
    // reconstructed afterwards. BR-30: advance % defaults from the awarded
    // vendor's standing policy.
    const before = { buyRatePaise: indent.buy_rate, vendorId: indent.vendor_id };
    await this.indentsRepository.update(trx, indentId, {
      vendor_id: quote.vendor_id,
      awarded_quote_id: quoteId,
      buy_rate: quote.amount,
      advance_pct: vendor.advance_pct,
      stage: 'VENDOR_ASSIGNED',
    });

    await this.auditService.record(trx, approver, {
      action: 'QUOTE_AWARD',
      entityType: 'indents',
      entityId: indentId,
      before,
      after: { buyRatePaise: quote.amount, vendorId: quote.vendor_id, quoteId },
    });
  }

  async placement(indentId: string, dto: PlacementDto, actor: AuthenticatedUser) {
    // Returns the FULL indent, not a stub. The detail page stores whatever this
    // resolves to as the whole record, so a three-field reply blanked every
    // other field on screen until the user reloaded.
    const { transitDelay } = await this.indentsRepository.transaction().execute(async (trx) => {
      const indent = await this.indentsRepository.findByIdForUpdate(trx, indentId);
      if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);
      if (indent.stage !== 'VENDOR_ASSIGNED') {
        throw new DomainException(409, 'NOT_AWARDED', 'A vehicle can only be placed on an awarded indent.');
      }

      // BR-42: the server recomputes and is authoritative — the frontend's
      // computed value is display only.
      const transitDelay = this.computeTransitDelay(indent.pickup_date, indent.reporting_rule, dto.reportedAt);
      const remarks = transitDelay
        ? [dto.remarks, `Reported after the client's ${indent.reporting_rule ?? 'agreed'} requirement.`]
            .filter(Boolean)
            .join(' ')
        : (dto.remarks ?? indent.remarks);

      const updated = await this.indentsRepository.update(trx, indentId, {
        vehicle_no: dto.vehicleNo,
        driver_name: dto.driverName,
        driver_licence: dto.driverLicence,
        reported_at: dto.reportedAt,
        remarks,
        stage: 'VEHICLE_PLACED',
      });
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'indents',
        entityId: indentId,
        before: { stage: indent.stage },
        after: { stage: updated.stage, transitDelay },
      });
      return { transitDelay };
    });
    return { ...(await this.getById(indentId)), transitDelay };
  }

  async createTrip(indentId: string, actor: AuthenticatedUser) {
    const trip = await this.indentsRepository.transaction().execute(async (trx) => {
      const indent = await this.indentsRepository.findByIdForUpdate(trx, indentId);
      if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);
      if (indent.stage !== 'VEHICLE_PLACED') {
        throw new DomainException(409, 'NOT_PLACED', 'A trip can only be created once a vehicle is placed.');
      }
      if (!indent.vendor_id || !indent.buy_rate) {
        throw new DomainException(409, 'NOT_AWARDED', 'This indent has not been awarded.');
      }

      // BR-21/BR-14: consumed inside the transaction that creates the trip.
      const code = await this.numberingService.issue(trx, 'TRIP');
      const trip = await trx
        .insertInto('trips')
        .values({
          code,
          indent_id: indentId,
          client_id: indent.client_id,
          vendor_id: indent.vendor_id,
          branch_id: indent.branch_id,
          vehicle_no: indent.vehicle_no ?? '',
          driver_name: indent.driver_name,
          driver_licence: indent.driver_licence,
          lane: `${indent.from_city} → ${indent.to_city}`,
          weight_kg: indent.weight_kg,
          transit_days_required: indent.transit_days,
          remarks: indent.remarks,
          buy_rate: indent.buy_rate,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.indentsRepository.update(trx, indentId, { stage: 'TRIP_CREATED' });
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'indents',
        entityId: indentId,
        before: { stage: 'VEHICLE_PLACED' },
        after: { stage: 'TRIP_CREATED', tripId: trip.id },
      });
      return { id: trip.id, code: trip.code };
    });
    // Step 2, "Trip generated". `recompute` also opens the order if the indent
    // somehow never got one, so this doubles as a repair point.
    await this.syncOrder(indentId, actor);
    return trip;
  }

  async patchAdvancePct(indentId: string, advancePct: number, reason: string, actor: AuthenticatedUser) {
    assertReason(reason);
    const indent = await this.indentsRepository.findById(indentId);
    if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);

    const vendor = indent.vendor_id ? await this.vendorsRepository.findById(indent.vendor_id) : undefined;

    // No award yet (no standing policy to depart from), or it matches the
    // awarded vendor's own policy: apply directly, no approval needed.
    if (!indent.vendor_id || (vendor && vendor.advance_pct === advancePct)) {
      const updated = await this.indentsRepository.transaction().execute((trx) =>
        this.indentsRepository.update(trx, indentId, { advance_pct: advancePct }),
      );
      return { id: updated.id, advancePct: updated.advance_pct };
    }

    const action: IndentAdvancePctAction = { indentId, newPct: advancePct };
    return this.approvalsService.raise(
      {
        kind: 'ADVANCE_POLICY_CHANGE',
        entityType: 'indents',
        entityId: indentId,
        reason,
        title: `Advance % override · ${indent.code}`,
        detail: `${indent.advance_pct}% → ${advancePct}% (vendor standard: ${vendor?.advance_pct ?? 'n/a'}%)`,
        amountPaise: null,
        action,
      },
      actor,
    );
  }

  private computeTransitDelay(pickupDate: string, reportingRule: string | null, reportedAt: string): boolean {
    const pickup = new Date(pickupDate);
    const reported = new Date(reportedAt);
    if (reportingRule === 'SAME_DAY') {
      return reported.toDateString() !== pickup.toDateString() && reported > pickup;
    }
    if (reportingRule === 'NEXT_DAY') {
      const nextDay = new Date(pickup);
      nextDay.setDate(nextDay.getDate() + 1);
      return reported > nextDay;
    }
    // SCHEDULED (or unset): no server-checkable deadline stored beyond the
    // reporting rule itself — nothing to compare against.
    return false;
  }
}
