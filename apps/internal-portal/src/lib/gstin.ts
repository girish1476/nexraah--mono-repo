/**
 * GSTIN format and check-digit validation — the one "GSTN integration" that
 * needs no live API call. `docs/specs/internal-spec/13-cross-cutting.md` §2
 * scopes GSTN as **advisory only**: a failed check warns and never blocks,
 * because a small transporter may legitimately sit below the GST
 * registration threshold. A real GSTN lookup (does this GSTIN exist, is it
 * active) is a separate, actual API integration and is not attempted here —
 * this only catches malformed/mistyped GSTINs the way a check digit always
 * can, offline, for free.
 *
 * Structure (15 characters): 2-digit state code, 10-character PAN, 1-digit
 * entity code, literal 'Z', 1 alphanumeric check digit.
 */

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const GSTIN_SHAPE_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

/** The GSTIN check-digit algorithm: base-36, alternating ×1/×2, digit-sum fold. */
export function gstinCheckDigit(first14: string): string {
  let total = 0;
  let mul = 1;
  for (let i = 0; i < first14.length; i++) {
    const value = CHARSET.indexOf(first14[i]);
    const product = value * mul;
    total += Math.floor(product / 36) + (product % 36);
    mul = mul === 1 ? 2 : 1;
  }
  const checkValue = (36 - (total % 36)) % 36;
  return CHARSET[checkValue];
}

export interface GstinCheck {
  /** True only when both the structural shape and the check digit are right. */
  valid: boolean;
  /** Present whenever `valid` is false — always advisory copy, never blocking. */
  reason?: string;
}

/**
 * Case-insensitive on input (GSTINs are conventionally upper-case; forms in
 * this app already upper-case on blur, but this doesn't assume that).
 */
export function checkGstin(raw: string): GstinCheck {
  const value = raw.trim().toUpperCase();
  if (!value) return { valid: true }; // empty is a required-field concern, not a format one
  if (value.length !== 15) {
    return { valid: false, reason: `GSTIN is 15 characters — this is ${value.length}.` };
  }
  if (!GSTIN_SHAPE_RE.test(value)) {
    return { valid: false, reason: 'Does not match the GSTIN pattern (state code, PAN, entity code, check digit).' };
  }
  if (gstinCheckDigit(value.slice(0, 14)) !== value[14]) {
    return { valid: false, reason: 'The check digit does not match — likely a typo.' };
  }
  return { valid: true };
}
