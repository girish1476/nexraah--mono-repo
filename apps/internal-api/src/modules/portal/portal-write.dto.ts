import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { FLEET_STATUSES } from './portal.constants';

/**
 * Request bodies for the four JSON writes. Separate from `portal.dto.ts`, which
 * is the RESPONSE allow-list (layer four of the redaction contract) — these run
 * in the opposite direction and are validated, not exposed.
 *
 * The global `ValidationPipe` is `{ whitelist: true, transform: true }`
 * (`main.ts`), so a property that is not decorated here is stripped from the
 * body before a handler ever sees it. That is what stops a transporter posting
 * `{ status: "DOCS_DUE" }`… no: `status` IS accepted, precisely so that
 * `DOCS_DUE` can be REFUSED rather than silently dropped —
 * `04-P3` §2 / `11-portal.md` §5.3: "A request naming it is rejected, not
 * ignored." A whitelist-strip would be the ignoring the spec forbids.
 */

/**
 * `04-P3` §1: "Indian format, unique **within vendor**". The format is checked
 * loosely on purpose — BH-series, older state formats and the spacing a phone
 * keyboard produces all have to pass, and a registration this server rejects is
 * a truck the transporter cannot offer at all.
 */
const REGISTRATION = /^[A-Za-z0-9][A-Za-z0-9 -]{4,18}$/;

// ── POST /portal/loads/:code/quote — 11-portal.md §5.2 ────────────────────

export class SubmitQuoteDto {
  /**
   * Money is bigint paise (`00-conventions.md` §5). `Min(1)` matches
   * `quotes.amount check (amount > 0)`; the band check is a business rule and
   * lives in the service, not here — `BELOW_BAND` is a `422` with
   * `details.bidMin`, not a `400` with a validator sentence.
   */
  @IsInt()
  @Min(1)
  amountPaise!: number;

  /** Their own `vendor_fleet.id`. Another vendor's is `404`, never `403`. */
  @IsOptional()
  @IsUUID()
  vehicleId?: string;

  /**
   * What the quote form actually sends (`FE.md`, `loads/[code]/quote`): a
   * number plate typed or picked from the fleet list — a transporter with no
   * truck saved yet can still quote. Until this was declared, the whitelist
   * stripped it silently and every portal bid reached the Ops desk with an
   * empty Truck column. Resolved against their own fleet in the service when
   * it matches one; kept as typed when it doesn't.
   */
  @IsOptional()
  @IsString()
  @Matches(REGISTRATION)
  vehicleRegistrationNo?: string;

  /** Indian mobile, same rule the form applies before it lets them submit. */
  @IsOptional()
  @Matches(/^[6-9]\d{9}$/)
  driverMobile?: string;

  /** When the truck reports — the load's own rule, or the one they can offer instead. */
  @IsOptional()
  @IsIn(['SAME_DAY', 'NEXT_DAY', 'SCHEDULED'])
  reportingRule?: 'SAME_DAY' | 'NEXT_DAY' | 'SCHEDULED';

  /** `YYYY-MM-DD`, only meaningful with `SCHEDULED`. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduledDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

// ── POST /portal/fleet, PATCH /portal/fleet/:id — 11-portal.md §5.3 ───────

/** A geotag coordinate as a multipart text part. Range is checked in the service. */
const SIGNED_DECIMAL = /^-?\d{1,3}(\.\d{1,10})?$/;

export class AddVehicleDto {
  @IsString()
  @Matches(REGISTRATION)
  registrationNo!: string;

  @IsString()
  @MaxLength(60)
  truckType!: string;

  @IsInt()
  @Min(1)
  capacityKg!: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  currentCity?: string;

  /**
   * The full four-value enum, `DOCS_DUE` included. See the file note: it is
   * accepted by the validator so the service can answer
   * `422 DOCS_DUE_NOT_SETTABLE`, which is a different thing from ignoring it.
   */
  @IsOptional()
  @IsIn(FLEET_STATUSES as readonly string[])
  status?: string;

  /** `YYYY-MM-DD`. Required when `ON_TRIP` — `422 FREE_FROM_REQUIRED`. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  freeFrom?: string | null;
}

/**
 * Every field optional: `PATCH` is a partial update, and "absent" has to stay
 * distinguishable from "cleared". `freeFrom: null` clears the date; omitting it
 * leaves whatever is there.
 */
export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @Matches(REGISTRATION)
  registrationNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  truckType?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacityKg?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  currentCity?: string | null;

  @IsOptional()
  @IsIn(FLEET_STATUSES as readonly string[])
  status?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  freeFrom?: string | null;
}

// ── The three multipart writes — 11-portal.md §4 ──────────────────────────
//
// `multipart/form-data` has no types: every text part arrives as a string,
// whatever the field means. So none of these carry `@IsInt`/`@IsDate` — a
// validator that cannot see a number would reject every well-formed request —
// and the parsing lives in the services.
//
// More importantly, **every field below is `@IsOptional()`**, including the
// ones the spec marks required. That is deliberate and is not a relaxation: a
// `@IsString()` on a missing `courierDocketNo` produces
// `400 VALIDATION_ERROR` with a class-validator sentence, and `11-portal.md`
// §2 requires `422 POD_DOCKET_REQUIRED` in the transporter's own vocabulary.
// Requiredness is therefore asserted in the service, where the right code and
// the right sentence are both available. The validators here narrow SHAPE
// (a string, a date-looking string, a bounded length); the services decide
// PRESENCE.

/**
 * `POST /portal/trips/:id/pod` — `11-portal.md` §5.4, `BR-51`.
 * The file parts are `files[]` and are read from `@UploadedFiles()`, never
 * from the body.
 */
export class AttachPodDto {
  /**
   * `FE.md`'s field is `courierDocketNo`; `11-portal.md` §4's sketch calls it
   * `docketNo`. Both are accepted rather than picking a winner, because the
   * cost of guessing wrong is a transporter who cannot send their POD at all.
   * The service reads `courierDocketNo ?? docketNo`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  courierDocketNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  docketNo?: string;

  /** `YYYY-MM-DD`, and `≤ today` — the ceiling is `POD_SENT_ON_INVALID`, in the service. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  sentOn?: string;

  /** Free text from the transporter. Lands in `pod_receipts.condition`. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

/**
 * `POST /portal/trips/:id/bill` — `11-portal.md` §5.5, `BR-53`, `D-37`.
 *
 * `07-P6` §2's amounts panel is "computed, read-only": freight, agreed charges
 * and bill total are the server's numbers, and the form posts none of them.
 * `billTotalPaise` is therefore OPTIONAL and is the exception that makes §3
 * real — §3's worked example is a transporter whose own copy says ₹29,050
 * against our ₹28,650, which cannot happen if the total is only ever ours.
 * Sent, it is accepted and the difference is flagged; absent, the bill is
 * raised for the computed total and the variance is zero.
 */
export class SubmitBillDto {
  /** Unique per vendor — `vendor_bills unique (vendor_id, bill_no)`, `409 BILL_NO_DUPLICATE`. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  billNo?: string;

  /** `YYYY-MM-DD`, `≤ today` → `422 BILL_DATE_FUTURE`. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  billDate?: string;

  /** Digits only, in paise. Never a rupee decimal — `00-conventions.md` §5. */
  @IsOptional()
  @Matches(/^\d{1,15}$/)
  billTotalPaise?: string;
}

/**
 * `POST /portal/profile/documents/:kind` — `11-portal.md` §5.6, `BR-23`.
 *
 * `lat`/`lng` in §5.6, `latitude`/`longitude` in `FE.md` §358-363. Both spellings
 * are accepted for the same reason the docket number is: a selfie that cannot
 * be uploaded because two documents disagree on a field name is a vendor who
 * cannot be activated.
 */
export class UploadDocumentDto {
  @IsOptional()
  @Matches(SIGNED_DECIMAL)
  latitude?: string;

  @IsOptional()
  @Matches(SIGNED_DECIMAL)
  longitude?: string;

  @IsOptional()
  @Matches(SIGNED_DECIMAL)
  lat?: string;

  @IsOptional()
  @Matches(SIGNED_DECIMAL)
  lng?: string;

  /** `vendor_documents.reference` — the licence/registration number on the paper. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  reference?: string;

  /** `YYYY-MM-DD`. `vendor_documents.valid_from` / `valid_to`; ignored for KYC kinds. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validFrom?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  validTo?: string;
}
