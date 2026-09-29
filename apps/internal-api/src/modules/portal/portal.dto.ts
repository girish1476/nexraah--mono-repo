import { Expose, Type, plainToInstance } from 'class-transformer';

/**
 * Layer four of `vendor-specs/02-redaction-contract.md` §3 — serialisation.
 *
 * > Explicit DTO classes with `@Expose()`. **Never return an entity directly.**
 * > Allow-list, never deny-list. `@Exclude()` means a column added next quarter
 * > is exposed by default and stays exposed until someone notices.
 *
 * Every portal read hands its row through `expose()` below, which runs
 * `excludeExtraneousValues` — a field that is not decorated in this file cannot
 * reach a transporter, whatever a repository later starts selecting. The
 * database grant (layer one) and the vendor scoping (layer three) already stop
 * `clientId`, `sellRate`, `sourcingRate`, `consignor` and `consignee`; this is
 * the layer that keeps stopping them if one of those is ever relaxed.
 *
 * The field lists are `02-redaction-contract.md` §1–§2 and `FE.md` §1–§5. Where
 * a field has no reachable source under the `vendor_api` grant it is present
 * and `null` rather than quietly dropped, so the gap is visible on the wire
 * instead of looking like a field nobody implemented.
 */

/** `plainToInstance` with the allow-list turned on. The only way out of a portal service. */
export function expose<T>(cls: new () => T, source: unknown): T {
  return plainToInstance(cls, source, { excludeExtraneousValues: true });
}

export function exposeAll<T>(cls: new () => T, source: unknown[]): T[] {
  return plainToInstance(cls, source, { excludeExtraneousValues: true });
}

// ── Loads — 02-redaction-contract.md §1 ───────────────────────────────────

/**
 * The only quote a load may carry, and it is theirs (`§1`: "`myQuote` is the
 * only field that reflects any quote at all, and it reflects exactly one").
 * No `quoteCount`, no rank, no other vendor's amount.
 */
export class PortalMyQuoteDto {
  @Expose() id: string;
  /** `SUBMITTED` in band; `PENDING_APPROVAL` above it (`D-39`). */
  @Expose() status: string;
  @Expose() amountPaise: number;
}

export class PortalLoadDto {
  /** The `IND-` series. `LD-` is the lead series and a different entity (§1). */
  @Expose() code: string;
  @Expose() originCity: string;
  @Expose() destinationCity: string;
  @Expose() truckType: string;
  @Expose() weightKg: number;
  @Expose() goods: string;
  /** No lane distance exists under any grant this pool holds — see portal-loads.service.ts. */
  @Expose() distanceKm: number | null;
  @Expose() transitDays: number | null;
  @Expose() reportingRule: string | null;
  @Expose() remarks: string | null;
  @Expose() pickupAt: string;
  @Expose() bandLowPaise: number | null;
  @Expose() bandHighPaise: number | null;
  @Expose() advancePct: number;
  @Expose() @Type(() => PortalMyQuoteDto) myQuote: PortalMyQuoteDto | null;
}

// ── Quotes — vendor-specs/03 §3 ───────────────────────────────────────────

export class PortalQuoteDto {
  @Expose() id: string;
  @Expose() loadCode: string;
  @Expose() originCity: string;
  @Expose() destinationCity: string;
  @Expose() amountPaise: number;
  @Expose() status: string;
  @Expose() submittedAt: string;
  /** Their own amount over the ceiling they can already see. Never a rival's. */
  @Expose() aboveBandByPaise: number | null;
  @Expose() tripId: string | null;
  /**
   * A fixed enum, never free text, and never a price. `03-P2` §3: "Rejected
   * never says why. Not 'priced too high', not 'another transporter was
   * cheaper', not a rank."
   */
  @Expose() lostReason: string | null;
}

/**
 * `POST /portal/loads/:code/quote` — `FE.md` §66. Deliberately NOT
 * `PortalQuoteDto`: the create response is the five fields the confirmation
 * screen reads, and adding the list shape's `aboveBandByPaise`/`tripId`/
 * `lostReason` here would put three always-null fields on a 201.
 *
 * `aboveBand` is a boolean, never a distance and never a rank. The transporter
 * already knows the ceiling (`bandHighPaise` is on the load card); what they
 * must not learn is anything about anyone else's number.
 */
export class PortalQuoteCreatedDto {
  @Expose() id: string;
  @Expose() loadCode: string;
  @Expose() amountPaise: number;
  /** `SUBMITTED` in band; `PENDING_APPROVAL` above it (`D-39`). */
  @Expose() status: string;
  @Expose() aboveBand: boolean;
}

/**
 * `DELETE /portal/quotes/:id` returns `204` with no body. This is the shape a
 * REPLAY of that delete returns (`11-portal.md` §3: "`200`, already
 * withdrawn"), and the only reason it exists.
 */
export class PortalQuoteWithdrawnDto {
  @Expose() id: string;
  @Expose() status: string;
}

// ── Trips — FE.md §142-176 ────────────────────────────────────────────────

export class PortalTripBlockerDto {
  @Expose() what: string;
  @Expose() why: string;
}

export class PortalTripMilestoneDto {
  @Expose() key: string;
  @Expose() label: string;
  @Expose() at: string | null;
  @Expose() done: boolean;
}

export class PortalTripDto {
  @Expose() id: string;
  @Expose() lrNo: string | null;
  @Expose() originCity: string;
  @Expose() destinationCity: string;
  @Expose() distanceKm: number | null;
  @Expose() status: string;
  @Expose() podStatus: string;
  @Expose() podRejectionReason: string | null;
  @Expose() vehicleRegistrationNo: string;
  @Expose() driverName: string | null;
  @Expose() driverPhone: string | null;
  /** Their awarded rate (`trips.buy_rate`), never the client's (`indents.sell_rate`). */
  @Expose() freightPaise: number;
  @Expose() advancePct: number;
  @Expose() advancePaise: number;
  @Expose() advanceReleasedAt: string | null;
  @Expose() advanceUtr: string | null;
  @Expose() @Type(() => PortalTripBlockerDto) advanceBlockers: PortalTripBlockerDto[];
  @Expose() balancePaise: number;
  @Expose() penaltyPaise: number;
  @Expose() netPayablePaise: number;
  @Expose() deliveredAt: string | null;
  @Expose() podDaysElapsed: number | null;
  @Expose() podPenaltyPerDayPaise: number;
  @Expose() billId: string | null;
  @Expose() @Type(() => PortalTripMilestoneDto) milestones: PortalTripMilestoneDto[];
}

// ── Lorry receipt — 02-redaction-contract.md §2 ───────────────────────────

/**
 * Absent by contract: `consignor`, `consignee`, `clientName`, `clientInvoiceNo`,
 * `clientInvoiceValue`, `sellRate`. The printed document behind `pdfUrl` does
 * carry consignor and consignee — it must, legally — which is exactly why it is
 * server-rendered and never built from this payload.
 */
export class PortalLorryReceiptDto {
  @Expose() lrNo: string;
  @Expose() issuedAt: string;
  @Expose() originCity: string;
  @Expose() destinationCity: string;
  @Expose() goods: string;
  @Expose() weightKg: number | null;
  @Expose() truckType: string | null;
  @Expose() vehicleRegistrationNo: string;
  @Expose() driverName: string | null;
  @Expose() driverLicenceNo: string | null;
  @Expose() transitDays: number | null;
  @Expose() ewayBillNo: string | null;
  @Expose() ewayValidUpto: string | null;
  @Expose() freightPaise: number;
  @Expose() advancePaise: number;
  @Expose() balancePaise: number;
  /** Signed, 15-minute expiry. Null while no rendered document exists. */
  @Expose() pdfUrl: string | null;
}

// ── POD — vendor-specs/05, 11-portal.md §5.4 ──────────────────────────────

/** A stored page, behind a signed 15-minute URL (§4). Never a storage path. */
export class PortalAttachmentDto {
  /** Signed, 15-minute expiry. Null when the store could not be reached to sign. */
  @Expose() url: string | null;
  @Expose() expiresAt: string | null;
}

/**
 * `POST /portal/trips/:id/pod` — `BR-51`.
 *
 * **There is no `podReceivedAt` on this class and there must never be one.**
 * `BR-49`: the clock stops when the branch physically receives the paper copy,
 * and attaching is not that. `11-portal.md` §5.4 — "**Attaching does not stop
 * the penalty clock** and the response must not imply it did" — is a rule about
 * this payload specifically, which is why `penaltyClockRunning` and `notice`
 * are on it: the screen has to say so out loud, or the transporter reasonably
 * assumes the upload was the deadline.
 */
export class PortalPodReceiptDto {
  @Expose() podId: string;
  @Expose() tripId: string;
  /** `ATTACHED`, always. `docs/api/05-pod.md` picks the lifecycle up at `RECEIVED`. */
  @Expose() status: string;
  @Expose() courierDocketNo: string;
  @Expose() sentOn: string;
  @Expose() note: string | null;
  @Expose() pages: number;
  @Expose() @Type(() => PortalAttachmentDto) files: PortalAttachmentDto[];
  @Expose() attachedAt: string;
  /** Always `true` on this response. The clock runs until the branch receives the paper. */
  @Expose() penaltyClockRunning: boolean;
  @Expose() notice: string;
}

// ── Vendor bill — vendor-specs/07-P6, 11-portal.md §5.5 ───────────────────

/** One line of the blocked-state checklist. `✓ met` / `✗ not met`, both rendered. */
export class PortalBillConditionDto {
  @Expose() label: string;
  @Expose() met: boolean;
}

/**
 * `GET /portal/trips/:id/bill` — the state the screen is in BEFORE anyone types
 * a bill number. `07-P6` §2: "The checklist shows what is done as well as what
 * is not", which is why `conditions` carries met entries too rather than only
 * the blockers.
 *
 * The amounts panel is "computed, read-only" (§2) — these three are the panel.
 */
export class PortalBillChecklistDto {
  @Expose() tripId: string;
  @Expose() submittable: boolean;
  @Expose() @Type(() => PortalBillConditionDto) conditions: PortalBillConditionDto[];
  @Expose() freightPaise: number;
  @Expose() agreedChargesPaise: number;
  @Expose() billTotalPaise: number;
  /** Set once a bill exists, so the screen can show it instead of the form. */
  @Expose() billId: string | null;
  @Expose() billNo: string | null;
  @Expose() billStatus: string | null;
  /** `07-P6` §2. On the form beside the amount, never in a help panel. */
  @Expose() declaration: string;
}

/**
 * `POST /portal/trips/:id/bill`.
 *
 * `variancePaise` is **signed** and `total - computed_balance`, the same
 * direction as the generated column: positive means the transporter billed
 * more than we computed. `07-P6` §3 — "**A mismatch does not reject the bill.**
 * It flags it for finance, because the transporter may be right" — so
 * `flagged` is an outcome reported here, never a refusal, and `message` is the
 * sentence §3 requires be said back immediately ("Naming the difference
 * immediately is what stops the follow-up call").
 */
export class PortalVendorBillDto {
  @Expose() billId: string;
  @Expose() tripId: string;
  @Expose() billNo: string;
  @Expose() billDate: string;
  @Expose() status: string;
  @Expose() computedBalancePaise: number;
  @Expose() billedPaise: number;
  @Expose() variancePaise: number;
  @Expose() flagged: boolean;
  @Expose() message: string;
  @Expose() submittedAt: string;
  @Expose() @Type(() => PortalAttachmentDto) file: PortalAttachmentDto | null;
}

// ── KYC upload — vendor-specs/08-P7, 11-portal.md §5.6 ────────────────────

/**
 * `POST /portal/profile/documents/:kind`.
 *
 * `status` is `PENDING` on every successful upload. `BR-23`: a re-uploaded
 * document is re-verified by Compliance, so it resets to `PENDING` and never
 * carries a previous `VERIFIED` forward — the previous decision was about the
 * previous file.
 */
export class PortalDocumentUploadedDto {
  @Expose() kind: string;
  @Expose() label: string;
  /** `PENDING`, always. */
  @Expose() status: string;
  @Expose() uploadedAt: string;
  @Expose() @Type(() => PortalAttachmentDto) file: PortalAttachmentDto | null;
  @Expose() needsGeotag: boolean;
  @Expose() capture: boolean;
  @Expose() message: string;
}

// ── Fleet — vendor-specs/04 ───────────────────────────────────────────────

export class PortalDocsDueDto {
  @Expose() documentKind: string;
  @Expose() documentLabel: string;
  @Expose() expiredOn: string | null;
}

export class PortalFleetVehicleDto {
  @Expose() id: string;
  @Expose() registrationNo: string;
  @Expose() truckType: string;
  @Expose() capacityKg: number;
  @Expose() currentCity: string | null;
  @Expose() status: string;
  @Expose() freeFrom: string | null;
  /** Set only while `DOCS_DUE` — "a bare `DOCS_DUE` pill generates a support call". */
  @Expose() @Type(() => PortalDocsDueDto) docsDue: PortalDocsDueDto | null;
}

// ── Profile — vendor-specs/08 ─────────────────────────────────────────────

export class PortalVendorDocumentDto {
  @Expose() kind: string;
  @Expose() label: string;
  @Expose() status: string;
  @Expose() rejectionReason: string | null;
  @Expose() rejectedOn: string | null;
  @Expose() expiredOn: string | null;
  @Expose() groundsVehicleRegistrationNo: string | null;
  @Expose() capture: boolean;
  @Expose() needsGeotag: boolean;
}

export class PortalDocumentGroupDto {
  @Expose() group: string;
  @Expose() @Type(() => PortalVendorDocumentDto) documents: PortalVendorDocumentDto[];
}

export class PortalBusinessDto {
  @Expose() trips: number;
  @Expose() valuePaise: number;
  @Expose() outstandingPaise: number;
}

export class PortalProfileDto {
  @Expose() vendorCode: string;
  @Expose() companyName: string;
  @Expose() contactName: string | null;
  @Expose() phone: string;
  @Expose() city: string;
  @Expose() gstin: string | null;
  /** Masked at the mapper, `BR-04` / `NFR-04`. The full value never leaves the row. */
  @Expose() panMasked: string | null;
  @Expose() aadhaarLast4: string | null;
  @Expose() bankAccountMasked: string | null;
  @Expose() bankIfsc: string | null;
  @Expose() advancePolicyPct: number;
  @Expose() @Type(() => PortalBusinessDto) business: PortalBusinessDto;
  @Expose() @Type(() => PortalDocumentGroupDto) documents: PortalDocumentGroupDto[];
}
