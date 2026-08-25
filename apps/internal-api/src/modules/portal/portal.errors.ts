import { DomainException } from '../../common/domain-exception';

/**
 * `docs/api/11-portal.md` §2. The vocabulary here is the TRANSPORTER'S, from
 * `vendor-specs/11-cross-cutting.md` §2 — it is a closed set, and the closure
 * is the point:
 *
 * > An internal error code must never reach a transporter. `ADVANCE_BLOCKED`
 * > with its `details.unmet` array, `VENDOR_INCOMPLETE`, `SERIES_LOWERED` and
 * > the rest of `00-conventions.md` §3 are internal vocabulary; several carry
 * > field names a transporter has no business learning.
 *
 * An unmapped code escaping to `/portal/*` is a `BR-55` finding, so
 * `PortalExceptionFilter` fails CLOSED: anything not in this table becomes
 * `REQUEST_FAILED` with no details at all, rather than leaking a code whose
 * name is itself information.
 */
export const PORTAL_ERROR_STATUS: Record<string, number> = {
  // Provenance and audience — ADR-02 §4
  SERVICE_KEY_REQUIRED: 403,
  WRONG_AUDIENCE: 403,
  UNAUTHORIZED: 401,

  // Suspension — vendor-specs/01-P1 §2.3: reads allowed, writes refused
  VENDOR_SUSPENDED: 403,

  // Generic
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  RATE_LIMITED: 429,
  REQUEST_FAILED: 500,
  STORAGE_UNAVAILABLE: 502,
  UPSTREAM_TIMEOUT: 504,

  // Uploads — 11-portal.md §4
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,

  // Quotes — §5.2
  BELOW_BAND: 422,
  QUOTE_EXISTS: 409,
  QUOTE_NOT_WITHDRAWABLE: 409,
  LOAD_CLOSED: 409,
  VEHICLE_UNAVAILABLE: 422,

  // Fleet — §5.3
  VEHICLE_DUPLICATE: 409,
  DOCS_DUE_NOT_SETTABLE: 422,
  FREE_FROM_REQUIRED: 422,

  // POD — §5.4
  POD_DOCKET_REQUIRED: 422,
  POD_SENT_ON_INVALID: 422,
  POD_FILE_REQUIRED: 422,
  /**
   * The plural is the one `POST /portal/trips/:id/pod` actually raises — the
   * endpoint takes `files[]`, and "attach at least one page" is the sentence
   * the transporter needs. `POD_FILE_REQUIRED` is kept beside it because it is
   * already in the vendor vocabulary and a client may still be checking for it.
   */
  POD_FILES_REQUIRED: 422,
  POD_NOT_DELIVERED: 409,

  // Vendor bill — §5.5
  POD_NOT_APPROVED: 409,
  BILL_NO_DUPLICATE: 409,
  BILL_DATE_FUTURE: 422,
  BILL_FILE_REQUIRED: 422,

  // Profile and KYC — §5.6
  UNKNOWN_DOCUMENT_KIND: 404,
  GEOTAG_REQUIRED: 422,
};

/**
 * The only codes whose `details` survive the filter, and exactly what may be
 * in them. Everything else is dropped: `details.unmet` on an internal
 * `ADVANCE_BLOCKED` names `trip_documents` kinds, and `00-conventions.md` §6's
 * list is written for a desk that owns those documents, not for the party
 * whose documents they are.
 *
 * `BELOW_BAND` keeps `details.bidMin` because §2 requires it — the floor is
 * already on the load the transporter is looking at (`bandLowPaise`), so it
 * discloses nothing new, and `bidMax` is deliberately NOT echoed.
 */
export const PORTAL_DETAIL_ALLOWLIST: Record<string, readonly string[]> = {
  BELOW_BAND: ['bidMin'],
  VALIDATION_ERROR: ['messages'],
};

/**
 * The mapping §2 requires every portal handler to apply "before throwing".
 * Left-hand side is every code an internal service reachable from a portal
 * handler can raise (`00-conventions.md` §3, plus the codes the shared
 * `ApprovalsService`, `StorageService` and `AttachmentsService` throw);
 * right-hand side is what the transporter is told instead.
 *
 * A code missing from BOTH this map and `PORTAL_ERROR_STATUS` is the failure
 * this table exists to catch, and the filter turns it into `REQUEST_FAILED`
 * rather than passing it on.
 */
export const INTERNAL_TO_PORTAL_CODE: Record<string, string> = {
  // Payment gates — the `details.unmet` shapes, dropped with the code.
  ADVANCE_BLOCKED: 'REQUEST_FAILED',
  BALANCE_BLOCKED: 'REQUEST_FAILED',
  ADVANCE_ALREADY_RELEASED: 'REQUEST_FAILED',
  POD_FORFEITED: 'REQUEST_FAILED',

  // Vendor lifecycle — names the compliance desk's checklist.
  VENDOR_INCOMPLETE: 'REQUEST_FAILED',
  VENDOR_NOT_ACTIVE: 'VENDOR_SUSPENDED',
  ACCOUNT_DISABLED: 'UNAUTHORIZED',

  // POD lifecycle, internal half (docs/api/05-pod.md picks up at RECEIVED).
  NOT_RECEIVED: 'POD_NOT_APPROVED',
  NOT_VERIFIED: 'POD_NOT_APPROVED',
  APPROVER_IS_VERIFIER: 'REQUEST_FAILED',
  REMARKS_REQUIRED: 'VALIDATION_ERROR',

  // Approvals engine.
  ALREADY_DECIDED: 'REQUEST_FAILED',
  APPROVAL_HANDLER_MISSING: 'REQUEST_FAILED',
  REASON_TOO_SHORT: 'VALIDATION_ERROR',

  // Console-only vocabulary that could only reach here by mistake, mapped so
  // that the mistake is a dull 500 rather than an education.
  PERMISSION_DENIED: 'NOT_FOUND',
  PERMISSION_FIXED: 'REQUEST_FAILED',
  SERIES_LOWERED: 'REQUEST_FAILED',

  // Attachments / storage.
  UNSUPPORTED_MIME: 'UNSUPPORTED_FILE_TYPE',
  STORAGE_UPLOAD_FAILED: 'STORAGE_UNAVAILABLE',
  STORAGE_SIGN_FAILED: 'STORAGE_UNAVAILABLE',
  RAW_BODY_UNAVAILABLE: 'REQUEST_FAILED',

  // Nest built-ins that `AllExceptionsFilter` would otherwise name.
  BAD_REQUEST: 'VALIDATION_ERROR',
  FORBIDDEN: 'NOT_FOUND',
  ERROR: 'REQUEST_FAILED',
  INTERNAL_ERROR: 'REQUEST_FAILED',
};

/**
 * Messages the transporter sees for a mapped code. The internal message is
 * discarded along with the code — `"The advance is blocked by unverified
 * documents."` names a workflow the transporter is not part of.
 */
export const PORTAL_ERROR_MESSAGE: Record<string, string> = {
  SERVICE_KEY_REQUIRED: 'This endpoint is reachable only through the transporter portal.',
  WRONG_AUDIENCE: 'This endpoint is not part of the transporter surface.',
  UNAUTHORIZED: 'Please sign in again.',
  VENDOR_SUSPENDED: 'Your account is suspended. You can still view your records; please contact your branch.',
  NOT_FOUND: 'Not found.',
  VALIDATION_ERROR: 'The request could not be accepted as sent.',
  IDEMPOTENCY_KEY_REQUIRED: 'Idempotency-Key is required on this request.',
  RATE_LIMITED: 'Too many requests. Please try again shortly.',
  REQUEST_FAILED: 'We could not complete that. Please try again, or contact your branch.',
  STORAGE_UNAVAILABLE: 'The file store is not responding. Please try again.',
  FILE_TOO_LARGE: 'That file is larger than 10 MB.',
  UNSUPPORTED_FILE_TYPE: 'Only JPEG, PNG and PDF files are accepted.',

  // POD — §5.4. None of these mention the penalty clock: attaching does not
  // stop it (`BR-49`) and a message here that implied otherwise would be the
  // same mistake as setting `pod_received_at`, one layer up.
  POD_DOCKET_REQUIRED: 'Enter the courier docket number you sent the POD under.',
  POD_SENT_ON_INVALID: 'Enter the date you couriered the POD. It cannot be in the future.',
  POD_FILES_REQUIRED: 'Attach at least one photo or scan of the signed POD.',
  POD_FILE_REQUIRED: 'Attach at least one photo or scan of the signed POD.',
  POD_NOT_DELIVERED: 'This trip is not marked delivered yet, so there is no POD to send.',

  // Vendor bill — §5.5
  POD_NOT_APPROVED: 'Your bill can be raised once the proof of delivery has been approved.',
  BILL_NO_DUPLICATE: 'You have already used that bill number.',
  BILL_DATE_FUTURE: 'The bill date cannot be in the future.',
  BILL_FILE_REQUIRED: 'Attach a copy of your bill.',

  // Profile and KYC — §5.6
  UNKNOWN_DOCUMENT_KIND: 'Not found.',
  GEOTAG_REQUIRED: 'Turn on location so the photo can be geotagged, then try again.',
};

export function portalStatusFor(code: string): number {
  return PORTAL_ERROR_STATUS[code] ?? 500;
}

/** Convenience for handlers: throws in the transporter's vocabulary directly. */
export function portalError(code: string, message?: string, details?: unknown): DomainException {
  return new DomainException(
    portalStatusFor(code),
    code,
    message ?? PORTAL_ERROR_MESSAGE[code] ?? 'We could not complete that.',
    details,
  );
}
