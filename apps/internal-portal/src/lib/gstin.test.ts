import { describe, it, expect } from 'vitest';
import { checkGstin, gstinCheckDigit } from './gstin';

// A check digit's job is to catch a single mistyped character. We verify
// that property directly (round-trip: compute the digit for a shaped
// prefix, confirm the full GSTIN validates, then corrupt one character at a
// time and confirm each corruption is caught) rather than hard-coding one
// "known good" real-world GSTIN, since mock/sample GSTINs found in the wild
// are rarely check-digit-accurate themselves.
function buildValid(prefix14: string): string {
  return prefix14 + gstinCheckDigit(prefix14);
}

// 14 characters each: 2-digit state + 10-char PAN + 1-digit entity code +
// the mandatory literal 'Z' — the 15th (check digit) is computed, not here.
const SHAPED_PREFIXES = [
  '27AAPFU0939F1Z', // state 27, PAN AAPFU0939F, entity 1
  '19AAACB2545C1Z',
  '06BBBFF1234Q1Z',
  '33CCCCC9999C9Z',
];

describe('checkGstin — shape', () => {
  it('accepts empty as valid (a required-field concern, not a format one)', () => {
    expect(checkGstin('')).toEqual({ valid: true });
    expect(checkGstin('   ')).toEqual({ valid: true });
  });

  it('rejects the wrong length', () => {
    expect(checkGstin('27AAPFU0939F1Z').valid).toBe(false);
    expect(checkGstin(buildValid(SHAPED_PREFIXES[0]) + 'X').valid).toBe(false);
  });

  it('rejects a string of the right length but wrong shape', () => {
    // 'Z' literal in the wrong position
    expect(checkGstin('27AAPFU0939F1Y5').valid).toBe(false);
    // state code isn't digits
    expect(checkGstin('AAAAPFU0939F1Z5').valid).toBe(false);
  });

  it('is case-insensitive and tolerant of surrounding whitespace', () => {
    const gstin = buildValid(SHAPED_PREFIXES[0]);
    expect(checkGstin(` ${gstin.toLowerCase()} `)).toEqual({ valid: true });
  });
});

describe('checkGstin — check digit (round-trip)', () => {
  for (const prefix of SHAPED_PREFIXES) {
    it(`accepts a correctly-computed check digit for ${prefix}`, () => {
      expect(checkGstin(buildValid(prefix))).toEqual({ valid: true });
    });
  }

  it('rejects every single-character corruption of a valid GSTIN', () => {
    const gstin = buildValid(SHAPED_PREFIXES[0]);
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let corruptions = 0;
    let caught = 0;
    for (let i = 0; i < gstin.length; i++) {
      for (const ch of alphabet) {
        if (ch === gstin[i]) continue;
        const corrupted = gstin.slice(0, i) + ch + gstin.slice(i + 1);
        // A corruption might coincidentally still be shape-valid; we only
        // care that whenever it IS shape-valid, the check digit still
        // catches it (the whole point of a check digit).
        const stillShaped = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(corrupted);
        if (!stillShaped) continue;
        corruptions++;
        if (!checkGstin(corrupted).valid) caught++;
      }
    }
    expect(corruptions).toBeGreaterThan(0);
    expect(caught).toBe(corruptions);
  });

  it('gives a specific, advisory (non-blocking-sounding) reason on failure', () => {
    const result = checkGstin('27AAPFU0939F1Z0'); // wrong check digit
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/check digit/i);
  });
});
