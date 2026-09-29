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
import type { RecordQuoteDto } from './dto/record-quote.dto';
import type { CancelIndentDto } from './dto/cancel-indent.dto';

/** An indent untouched this long is put in front of Operations and Leadership to cancel or keep. */
export const STALE_INDENT_DAYS = 7;

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
   * that ordering is that the order row is only written once the indent is
   * genuinely real, so a rolled-back creation leaves nothing behind.
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
      await this.indentsRepository.update(ctx.db, action.indentId, {
        advance_pct: action.newPct,
        advance_pct_overridden: true,
      });
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
    const trip = await this.indentsRepository.findTripByIndent(id);

    return {
      id: indent.id,
      tripId: trip?.id ?? null,
      tripCode: trip?.code ?? null,
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
      advancePctOverridden: indent.advance_pct_overridden,
      transitDays: indent.transit_days,
      reportingRule: indent.reporting_rule,
      remarks: indent.remarks,
      vendorId: indent.vendor_id,
      vehicleNo: indent.vehicle_no,
      driverName: indent.driver_name,
      driverLicence: indent.driver_licence,
      reportedAt: indent.reported_at,
      failureCause: indent.failure_cause,
      cancelReason: indent.cancel_reason,
      cancelledAt: indent.cancelled_at,
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

    // The bid band is the client's, not the indent's: take it from the lane in
    // force for this route on the pickup date. No lane, no band — a spot load
    // or a route the rate card does not cover simply has nothing to enforce.
    const band = await this.indentsRepository.findLaneBandForRoute(
      dto.clientId,
      dto.fromCity,
      dto.toCity,
      dto.truckType,
      dto.pickupDate,
    );
    const bidMin = band?.bidMin ?? null;
    const bidMax = band?.bidMax ?? null;

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
        bid_min: bidMin,
        bid_max: bidMax,
        // BR-39: the band locks the moment the indent is published — from
        // creation, not from the first quote, or the tempting window (no
        // quote yet) would be exactly the one left open.
        band_locked: Boolean(bidMin || bidMax),
        // Only a figure the person actually typed is an override. Left blank,
        // the awarded vendor's standing policy fills it in at award (BR-30).
        advance_pct: dto.advancePct ?? 0,
        advance_pct_overridden: dto.advancePct !== undefined && dto.advancePct !== null,
      });
      await this.auditService.record(trx, actor, {
        action: 'INDENT_CREATED',
        entityType: 'indents',
        entityId: inserted.id,
        after: { code: inserted.code, branchId: matches[0].id },
      });
      return inserted;
    });

    // Step 1, "Indent created" — opens the order, which carries the indent's own id.
    await this.openOrder(row.id, actor);
    return this.getById(row.id);
  }

  /**
   * Operations enters a quotation on a transporter's behalf — the desk-side
   * twin of the vendor portal's own quote submission, for a transporter who
   * phoned or messaged the price instead of using the portal. Same rules as
   * the portal: below the floor is refused and never persisted (BR-05), above
   * the band is kept and flagged so awarding it goes to approval (D-39), and a
   * transporter has one live quote per indent.
   */
  async recordQuote(indentId: string, dto: RecordQuoteDto, actor: AuthenticatedUser) {
    const quoteId = await this.indentsRepository.transaction().execute(async (trx) => {
      const indent = await this.indentsRepository.findByIdForUpdate(trx, indentId);
      if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);
      if (indent.stage !== 'OPEN') {
        throw new DomainException(409, 'INDENT_NOT_OPEN', 'Quotes can only be entered while the indent is still open.');
      }

      const vendor = await this.vendorsRepository.findById(dto.vendorId);
      if (!vendor) throw new DomainException(404, 'NOT_FOUND', `Unknown transporter: ${dto.vendorId}`);
      if (vendor.status !== 'ACTIVE') {
        throw new DomainException(409, 'VENDOR_NOT_ACTIVE', 'Only an active transporter can be quoted for.');
      }

      if (indent.bid_min !== null && dto.amountPaise < indent.bid_min) {
        throw new DomainException(422, 'BELOW_BAND', 'That quote is below the floor for this lane and cannot be entered.', {
          bidMin: indent.bid_min,
        });
      }
      const bandPosition = indent.bid_max !== null && dto.amountPaise > indent.bid_max ? 'ABOVE_BAND' : 'IN_BAND';

      const existing = await this.indentsRepository.findQuoteByVendor(trx, indentId, dto.vendorId);
      if (existing) {
        throw new DomainException(409, 'QUOTE_EXISTS', 'This transporter already has a quote on this indent.');
      }

      const code = await this.numberingService.issue(trx, 'QUOTE');
      const quote = await this.indentsRepository.insertQuote(trx, {
        code,
        indentId,
        vendorId: dto.vendorId,
        amountPaise: dto.amountPaise,
        truckRegistration: dto.truckRegistration ?? null,
        remarks: dto.remarks ?? null,
        bandPosition,
      });
      await this.auditService.record(trx, actor, {
        action: 'QUOTE_ENTERED',
        entityType: 'indents',
        entityId: indentId,
        before: null,
        after: { quoteId: quote.id, vendorId: dto.vendorId, amountPaise: dto.amountPaise, bandPosition, enteredBy: 'OPERATIONS' },
      });
      return quote.id;
    });
    void quoteId;
    return this.getById(indentId);
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
    // Step 2, "Trip generated" — the award itself generates the trip now.
    await this.syncOrder(indentId, actor);
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
      // An order that asked for its own advance keeps it; otherwise it takes
      // the vendor's standing policy. Overwriting unconditionally threw away
      // whatever was entered when the indent was raised.
      advance_pct: indent.advance_pct_overridden ? indent.advance_pct : vendor.advance_pct,
      // Accepting a bid is what generates the trip; the vehicle is allocated
      // afterwards, on the trip. The indent goes straight to TRIP_CREATED.
      stage: 'TRIP_CREATED',
    });

    // A load whose transporter was reassigned keeps its trip: the trip that was set
    // aside comes back to life for the new transporter, so an indent never carries
    // two trip numbers.
    const setAside = await trx
      .selectFrom('trips')
      .select(['id', 'code'])
      .where('indent_id', '=', indentId)
      .where('stage', '=', 'CANCELLED')
      .forUpdate()
      .executeTakeFirst();
    const trip = setAside
      ? await trx
          .updateTable('trips')
          .set({
            stage: 'OPEN',
            vendor_id: quote.vendor_id,
            buy_rate: quote.amount,
            vehicle_no: '',
            driver_name: null,
            driver_licence: null,
            loading_supervisor_id: null,
            loading_started_at: null,
            loading_completed_at: null,
            departed_at: null,
          })
          .where('id', '=', setAside.id)
          .returning(['id', 'code'])
          .executeTakeFirstOrThrow()
      : await this.insertTrip(trx, {
          ...indent,
          vendor_id: quote.vendor_id,
          buy_rate: quote.amount,
          // The quoted truck is only a proposal; allocation confirms the vehicle.
          vehicle_no: null,
        });

    await this.auditService.record(trx, approver, {
      action: 'QUOTE_AWARD',
      entityType: 'indents',
      entityId: indentId,
      before,
      after: { buyRatePaise: quote.amount, vendorId: quote.vendor_id, quoteId, tripId: trip.id },
    });
  }

  /**
   * The one place a trip row is written. Consumes the TRIP number inside the
   * caller's transaction (BR-21/BR-14). `vehicle_no` is an empty string, not
   * null, until a vehicle is allocated — the column is NOT NULL and the trip
   * screens already read '' as "not placed yet".
   */
  private async insertTrip(
    trx: Parameters<IndentsRepository['findByIdForUpdate']>[0],
    indent: {
      id: string;
      client_id: string;
      vendor_id: string | null;
      branch_id: string;
      vehicle_no: string | null;
      driver_name: string | null;
      driver_licence: string | null;
      from_city: string;
      to_city: string;
      weight_kg: number;
      transit_days: number | null;
      remarks: string | null;
      buy_rate: number | null;
    },
  ) {
    const code = await this.numberingService.issue(trx, 'TRIP');
    return trx
      .insertInto('trips')
      .values({
        code,
        indent_id: indent.id,
        client_id: indent.client_id,
        vendor_id: indent.vendor_id as string,
        branch_id: indent.branch_id,
        vehicle_no: indent.vehicle_no ?? '',
        driver_name: indent.driver_name,
        driver_licence: indent.driver_licence,
        lane: `${indent.from_city} → ${indent.to_city}`,
        weight_kg: indent.weight_kg,
        transit_days_required: indent.transit_days,
        remarks: indent.remarks,
        buy_rate: indent.buy_rate as number,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * Vehicle allocation. Normally happens on a trip that award already created
   * (stage TRIP_CREATED, no vehicle yet); it can be repeated while the trip is
   * still OPEN and has no lorry receipt, to swap the vehicle. Indents awarded
   * before trips were generated at award time are still in VENDOR_ASSIGNED and
   * take the older path: placement, then `createTrip`.
   */
  async placement(indentId: string, dto: PlacementDto, actor: AuthenticatedUser) {
    // Returns the FULL indent, not a stub. The detail page stores whatever this
    // resolves to as the whole record, so a three-field reply blanked every
    // other field on screen until the user reloaded.
    const { transitDelay } = await this.indentsRepository.transaction().execute(async (trx) => {
      const indent = await this.indentsRepository.findByIdForUpdate(trx, indentId);
      if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);
      if (indent.stage !== 'VENDOR_ASSIGNED' && indent.stage !== 'TRIP_CREATED') {
        throw new DomainException(409, 'NOT_AWARDED', 'A vehicle can only be placed on an awarded indent.');
      }

      let trip: { id: string; stage: string } | undefined;
      if (indent.stage === 'TRIP_CREATED') {
        trip = await trx
          .selectFrom('trips')
          .select(['id', 'stage'])
          .where('indent_id', '=', indentId)
          .forUpdate()
          .executeTakeFirst();
        if (!trip) throw new DomainException(409, 'NO_TRIP', 'This indent has no trip to allocate a vehicle to.');
        if (trip.stage !== 'OPEN') {
          throw new DomainException(409, 'TRIP_UNDERWAY', 'The trip has left OPEN; its vehicle can no longer be changed here.');
        }
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
        stage: indent.stage === 'TRIP_CREATED' ? 'TRIP_CREATED' : 'VEHICLE_PLACED',
      });
      if (trip) {
        await trx
          .updateTable('trips')
          .set({ vehicle_no: dto.vehicleNo, driver_name: dto.driverName, driver_licence: dto.driverLicence, remarks })
          .where('id', '=', trip.id)
          .execute();
      }
      await this.auditService.record(trx, actor, {
        action: 'STATUS_CHANGE',
        entityType: 'indents',
        entityId: indentId,
        before: { stage: indent.stage, vehicleNo: indent.vehicle_no },
        after: { stage: updated.stage, vehicleNo: dto.vehicleNo, transitDelay },
      });
      return { transitDelay };
    });
    return { ...(await this.getById(indentId)), transitDelay };
  }

  /** Legacy path for indents still in VEHICLE_PLACED; award now creates the trip. */
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

      const trip = await this.insertTrip(trx, indent);

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

  // ---- Cancelling, reviewing and reassigning -----------------------------------

  /**
   * The client cancelled the load. Operations or Leadership records it, and the
   * remark is required. The trip an award generated is set aside with it, but only
   * while the truck has not left and no advance was paid: after that a cancellation
   * needs money to be recovered, which is not a button.
   */
  async cancel(indentId: string, dto: CancelIndentDto, actor: AuthenticatedUser) {
    await this.indentsRepository.transaction().execute(async (trx) => {
      const indent = await this.indentsRepository.findByIdForUpdate(trx, indentId);
      if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);
      if (indent.stage === 'CANCELLED') throw new DomainException(409, 'ALREADY_CANCELLED', 'This indent is already cancelled.');

      const trip = await trx.selectFrom('trips').selectAll().where('indent_id', '=', indentId).forUpdate().executeTakeFirst();
      if (trip && trip.stage !== 'CANCELLED') {
        if (trip.stage !== 'OPEN' || Number(trip.advance_paid) > 0) {
          throw new DomainException(
            409,
            'TRIP_UNDERWAY',
            'The truck has already left or an advance has been paid, so this load cannot simply be cancelled. Settle it first.',
          );
        }
        await trx.updateTable('trips').set({ stage: 'CANCELLED' }).where('id', '=', trip.id).execute();
      }
      await trx
        .updateTable('quotes')
        .set({ status: 'WITHDRAWN' })
        .where('indent_id', '=', indentId)
        .where('status', 'in', ['SUBMITTED', 'ACCEPTED'])
        .execute();
      await this.indentsRepository.update(trx, indentId, {
        stage: 'CANCELLED',
        cancel_reason: dto.reason.trim(),
        cancelled_at: new Date().toISOString(),
        cancelled_by: actor.userId,
      });
      await this.auditService.record(trx, actor, {
        action: 'INDENT_CANCELLED',
        entityType: 'indents',
        entityId: indentId,
        before: { stage: indent.stage },
        after: { stage: 'CANCELLED', reason: dto.reason.trim() },
      });
    });
    await this.syncOrder(indentId, actor, `Cancelled: ${dto.reason.trim()}`);
    return this.getById(indentId);
  }

  /** Nobody has touched these for a week. Anyone who works indents can see the list. */
  async stale(branchId?: string) {
    const rows = await this.indentsRepository.listStale(STALE_INDENT_DAYS, branchId);
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      clientName: r.clientName,
      lane: `${r.fromCity} → ${r.toCity}`,
      stage: r.stage,
      pickupDate: r.pickupDate,
      idleDays: Math.floor(
        (Date.now() - new Date(String(r.lastReviewedAt && r.lastReviewedAt > r.updatedAt ? r.lastReviewedAt : r.updatedAt)).getTime()) /
          86_400_000,
      ),
    }));
  }

  /** "Keep": somebody looked at it and it stays. Counts as a touch, and is on the audit trail. */
  async keep(indentId: string, actor: AuthenticatedUser) {
    await this.indentsRepository.transaction().execute(async (trx) => {
      const indent = await this.indentsRepository.findByIdForUpdate(trx, indentId);
      if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);
      if (indent.stage === 'CANCELLED') throw new DomainException(409, 'ALREADY_CANCELLED', 'This indent is cancelled.');
      await this.indentsRepository.update(trx, indentId, { last_reviewed_at: new Date().toISOString() });
      await this.auditService.record(trx, actor, {
        action: 'INDENT_KEPT',
        entityType: 'indents',
        entityId: indentId,
        after: { reviewedBy: actor.userId },
      });
    });
    return { id: indentId, kept: true };
  }

  /**
   * Leadership takes an awarded load off its transporter so another can be given it.
   * The awarded quote is withdrawn, the other quotes open again, and the indent goes
   * back to OPEN; its trip keeps its number, set aside until the next quote is
   * accepted. Only before the truck leaves and before any advance was paid.
   */
  async reassignTransporter(indentId: string, dto: CancelIndentDto, actor: AuthenticatedUser) {
    await this.indentsRepository.transaction().execute(async (trx) => {
      const indent = await this.indentsRepository.findByIdForUpdate(trx, indentId);
      if (!indent) throw new DomainException(404, 'NOT_FOUND', `Unknown indent: ${indentId}`);
      if (indent.stage !== 'TRIP_CREATED') {
        throw new DomainException(409, 'NOT_AWARDED', 'Only an awarded load has a transporter to reassign.');
      }
      const trip = await trx.selectFrom('trips').selectAll().where('indent_id', '=', indentId).forUpdate().executeTakeFirst();
      if (!trip || trip.stage !== 'OPEN' || Number(trip.advance_paid) > 0) {
        throw new DomainException(
          409,
          'TRIP_UNDERWAY',
          'The truck has already left or an advance has been paid, so the transporter cannot be swapped here.',
        );
      }
      const lr = await this.tripsLrIssued(trx, trip.id);
      if (lr) {
        throw new DomainException(409, 'LR_ISSUED', 'A lorry receipt has been issued for this transporter. Cancel it before reassigning.');
      }

      await trx.deleteFrom('trip_documents').where('trip_id', '=', trip.id).execute();
      await trx.deleteFrom('lorry_receipts').where('trip_id', '=', trip.id).execute();
      await trx.updateTable('trips').set({ stage: 'CANCELLED', loading_supervisor_id: null, loading_started_at: null, loading_completed_at: null }).where('id', '=', trip.id).execute();

      await trx.updateTable('quotes').set({ status: 'WITHDRAWN' }).where('id', '=', indent.awarded_quote_id as string).execute();
      await trx
        .updateTable('quotes')
        .set({ status: 'SUBMITTED' })
        .where('indent_id', '=', indentId)
        .where('status', '=', 'REJECTED')
        .execute();
      await this.indentsRepository.update(trx, indentId, {
        stage: 'OPEN',
        vendor_id: null,
        awarded_quote_id: null,
        buy_rate: null,
        vehicle_no: null,
        driver_name: null,
        driver_licence: null,
        reported_at: null,
      });
      await this.auditService.record(trx, actor, {
        action: 'INDENT_REASSIGNED',
        entityType: 'indents',
        entityId: indentId,
        before: { vendorId: indent.vendor_id, buyRatePaise: indent.buy_rate },
        after: { stage: 'OPEN', reason: dto.reason.trim() },
      });
    });
    await this.syncOrder(indentId, actor, `Transporter reassigned: ${dto.reason.trim()}`);
    return this.getById(indentId);
  }

  private async tripsLrIssued(trx: Parameters<IndentsRepository['findByIdForUpdate']>[0], tripId: string) {
    const row = await trx.selectFrom('lorry_receipts').select(['status']).where('trip_id', '=', tripId).executeTakeFirst();
    return !!row && row.status !== 'BOOKED' && row.status !== 'DRAFT';
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
        this.indentsRepository.update(trx, indentId, { advance_pct: advancePct, advance_pct_overridden: true }),
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
      return reported.toDateString() !== nextDay.toDateString() && reported > nextDay;
    }
    // SCHEDULED (or unset): no server-checkable deadline stored beyond the
    // reporting rule itself — nothing to compare against.
    return false;
  }
}
