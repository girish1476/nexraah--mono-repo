/**
 * Values the portal surface needs that live behind a grant `vendor_api` does
 * not hold. Each one is here because of a specific `REVOKE` in
 * `20260814090200_c1_roles_grants.sql`, not because a constant was easier.
 */

// ── POD penalty policy (BR-12, BR-24, BR-25) ──────────────────────────────
//
// The internal side reads these from `config` (`PodService.penaltyConfig`,
// `PaymentsService.penaltyLabelConfig`). `config` is in vendor_api's blanket
// REVOKE list and `supabase/tests/grants.sql` §3 asserts it stays there, so a
// portal handler cannot read the live row. These are the seeded values from
// `20260814090400_c1_role_permissions_and_config.sql` §config and the same
// fallbacks the two internal services already use, so the portal agrees with
// the console for every deployment that has not re-keyed them.
//
// KNOWN LIMITATION, flagged rather than hidden: if ops changes
// `pod_penalty_per_day_paise` in the control panel, the transporter's clock
// keeps quoting the seeded rate. Fixing that properly means either a
// `select` grant on the three `config` rows (a grants change, which is a
// security boundary this module does not get to move) or an internal-pool
// bridge read. Neither is in scope here.
export const POD_TAT_DAYS = 20;
export const POD_PENALTY_PER_DAY_PAISE = 10_000;
export const POD_FORFEIT_DAYS = 40;

// ── Upload policy — 11-portal.md §4 ───────────────────────────────────────
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * A POD is a signed paper, sometimes several pages, photographed on a phone at
 * a loading dock. The cap exists to bound one request, not to ration pages —
 * a transporter who has to choose which pages of their proof to send would
 * rightly send none, so it sits well above any real consignment note.
 */
export const MAX_POD_FILES = 12;

/**
 * Sniffed from content, never trusted from the `Content-Type` part header
 * (§4). Multer's `file.mimetype` is whatever the phone's browser chose to
 * claim; `application/pdf` on a `.exe` costs nothing to send.
 */
export const ALLOWED_UPLOAD_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

/**
 * `attachments.retain_until` is "set server-side from policy. Not a request
 * field" (§4). No `config` key names a retention period and `config` is
 * unreachable from this pool anyway; eight years is the statutory floor these
 * documents (LR, POD, vendor bill, KYC) are kept to under NFR-10 / R-04.
 */
export const ATTACHMENT_RETENTION_YEARS = 8;

/**
 * `attachments.uploaded_by` is a hard FK to the INTERNAL `users` table — not
 * `vendor_users`, not `auth.users` — so a transporter-originated upload still
 * needs a valid `users.id` to attribute to.
 * `20260824090000_c_portal_idempotency.sql` seeds exactly one row for this.
 *
 * `users` is in `vendor_api`'s blanket `REVOKE ALL`, so this pool cannot look
 * the id up by email. (The INSERT itself is fine: Postgres runs referential
 * integrity checks with the referencing table's owner privileges, not the
 * caller's — it is only the *lookup* that the revoke stops.) So the id is
 * supplied by configuration, and `PortalIdentityRepository.systemUploaderId()`
 * falls back to a best-effort read that is expected to fail on a correctly
 * granted database.
 */
export const PORTAL_SYSTEM_USER_EMAIL = 'portal-system@nexraah.internal';
export const PORTAL_SYSTEM_USER_ID_ENV = 'PORTAL_SYSTEM_USER_ID';

/**
 * `pod_receipts.code` is `not null unique` with no format CHECK. The console
 * mints `PDR-` codes through `NumberingService`/`number_series`, which is in
 * the same blanket `REVOKE ALL` — and unlike the quote case
 * (`portal_quote_code_seq`) there is no portal sequence to use, because adding
 * one is a `supabase/` migration this module does not get to write.
 *
 * So a portal-issued receipt takes a `PDR-P` prefix and a random suffix minted
 * by `gen_random_uuid()` in the INSERT itself. It is disjoint from the
 * console's `PDR-00001` on the shared unique index, which is the property that
 * actually matters; it is not gapless, and a POD receipt is not one of
 * `NFR-08`'s legally gapless series. Flagged rather than hidden: if a gapless
 * portal series is ever wanted, it is a sequence migration, not a code change.
 */
export const PORTAL_POD_CODE_PREFIX = 'PDR-P';

// ── Idempotency endpoint keys — 11-portal.md §3 ───────────────────────────
//
// The `endpoint` half of the `(vendor_id, endpoint, idempotency_key)` unique
// key. Stable strings, not request paths: a path carries the entity id, and
// two different trips sharing a key must still be two different rows.
export const PORTAL_ENDPOINT = {
  QUOTE_CREATE: 'POST /portal/loads/:code/quote',
  QUOTE_WITHDRAW: 'DELETE /portal/quotes/:id',
  FLEET_CREATE: 'POST /portal/fleet',
  FLEET_UPDATE: 'PATCH /portal/fleet/:id',
  POD_UPLOAD: 'POST /portal/trips/:id/pod',
  BILL_SUBMIT: 'POST /portal/trips/:id/bill',
  DOCUMENT_UPLOAD: 'POST /portal/profile/documents/:kind',
} as const;

// ── Vendor-facing document kinds ──────────────────────────────────────────
//
// `vendor_kyc.kind` and `vendor_documents.kind` are two different CHECK
// constraints on two different tables (`20260814090100` §vendor_kyc /
// §vendor_documents, widened by `20260814090500`). One portal endpoint,
// `POST /portal/profile/documents/:kind`, covers both — which table a kind
// lands in is a server-side detail the transporter never sees.
export const IDENTITY_KINDS = ['PAN', 'AADHAAR', 'ADDRESS', 'SELFIE'] as const;

export const BUSINESS_DOCUMENT_KINDS = [
  'TRADE_LICENCE',
  'LABOUR_LICENCE',
  'RC',
  'UDYAM',
  'TDS_DECLARATION',
  'BANK_STATEMENT',
  'TRANSPORTER_AGREEMENT',
] as const;

export type IdentityKind = (typeof IDENTITY_KINDS)[number];
export type BusinessDocumentKind = (typeof BUSINESS_DOCUMENT_KINDS)[number];

/** `needsGeotag` in `FE.md` §358-363 — the selfie, and only the selfie. */
export const GEOTAGGED_KINDS: readonly string[] = ['SELFIE'];

/** `capture="environment"` hint the profile screen renders (`FE.md` §349). */
export const CAPTURE_KINDS: readonly string[] = ['SELFIE'];

export const DOCUMENT_LABEL: Record<string, string> = {
  PAN: 'PAN card',
  AADHAAR: 'Aadhaar',
  ADDRESS: 'Address proof',
  SELFIE: 'Owner selfie',
  TRADE_LICENCE: 'Trade licence',
  LABOUR_LICENCE: 'Labour licence',
  RC: 'Vehicle registration certificate',
  UDYAM: 'Udyam registration',
  TDS_DECLARATION: 'TDS declaration',
  BANK_STATEMENT: 'Bank statement',
  TRANSPORTER_AGREEMENT: 'Transporter agreement',
};

// ── Fleet ─────────────────────────────────────────────────────────────────
export const FLEET_STATUSES = ['AVAILABLE', 'ON_TRIP', 'DOCS_DUE', 'MAINTENANCE'] as const;

/**
 * `11-portal.md` §5.3 / `FE.md` §310: derived from document verification
 * state, never accepted from the caller. "A request naming it is rejected,
 * not ignored."
 */
export const CALLER_SETTABLE_FLEET_STATUSES = ['AVAILABLE', 'ON_TRIP', 'MAINTENANCE'] as const;

// ── Portal permission codes ───────────────────────────────────────────────
//
// `20260814090400` §1 deliberately dropped `portal.self` / `portal.bill` from
// every `role_permissions` row: "the portal surface authorises via
// vendor_users + the service key (ADR-02 §4), never via role_permissions".
// So these are a fixed set carried on the resolved principal, not a query.
export const PORTAL_PERMISSIONS = ['portal.self', 'pod.upload', 'portal.bill'] as const;

/** `vendors.status` values that may hold a portal session at all. */
export const PORTAL_READABLE_VENDOR_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
