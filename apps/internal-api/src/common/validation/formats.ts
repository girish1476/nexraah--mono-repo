/**
 * Shared format rules for request validation.
 *
 * These exist because the backend had **none**. Before this file there was not
 * a single `@Matches` anywhere in `internal-api`: no GSTIN check, no PAN, no
 * IFSC, no phone. Meanwhile the portal validates all four
 * (`app/vendors/new/page.tsx`, `app/clients/new/page.tsx`, `lib/gstin.ts`).
 *
 * That is the same mistake the codebase already names for permissions —
 * `lib/permissions.ts`'s header says a hidden control is "presentation on top
 * of a server rule, never instead of one". Client-side format checks were
 * exactly *instead of* one: anything reaching the API by another route (a
 * script, a retry, a second client, curl) was unchecked.
 *
 * The patterns deliberately mirror the portal's character for character, so a
 * value the form accepts is not then refused by the server, and vice versa.
 * If one changes, change both.
 */

/** Indian mobile: ten digits starting 6-9. Mirrors the portal's `PHONE_RE`. */
export const PHONE_RE = /^[6-9]\d{9}$/;

/** `AAKCR2148L` — five letters, four digits, one letter. */
export const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

/** `HDFC0001234` — four letters, a literal 0, six alphanumerics. */
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * GSTIN structure: 2-digit state code, 10-char PAN, entity code, literal Z,
 * check digit.
 *
 * **Shape only, on purpose.** `docs/specs/internal-spec/13-cross-cutting.md`
 * §2 scopes the GSTN check as *advisory* — it warns and never blocks, because
 * a small transporter may legitimately sit below the registration threshold.
 * So the check digit (which the portal's `lib/gstin.ts` does compute) stays
 * advisory and is not enforced here; a 15-character value in the wrong shape
 * is a typo and is worth refusing, a correct-looking one we do not second
 * guess at the API boundary.
 */
export const GSTIN_SHAPE_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/**
 * Indian vehicle registration, loosely.
 *
 * Deliberately permissive: `MH 15 GT 4482`, `MH15GT4482`, older three-part
 * plates, BH-series and military formats all differ, and a plate that exists
 * on a truck at a loading dock is not going to be argued out of existence by a
 * regex. This catches obvious junk (empty, punctuation, wildly wrong length)
 * without refusing a real vehicle — the failure mode of a strict pattern here
 * is an operator unable to record a truck that is physically in front of them.
 */
export const VEHICLE_RE = /^[A-Z0-9][A-Z0-9 -]{4,14}$/i;

export const FORMAT_MESSAGE = {
  phone: 'Enter a ten-digit Indian mobile number.',
  pan: 'PAN looks wrong — it should read like AAKCR2148L.',
  ifsc: 'IFSC looks wrong — it should read like HDFC0001234.',
  gstin: 'GSTIN should be 15 characters: state code, PAN, entity code, Z, check digit.',
  vehicle: 'Vehicle number looks wrong — e.g. MH 15 GT 4482.',
} as const;
