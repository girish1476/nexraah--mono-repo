import { describe, it, expect } from 'vitest';
import {
  inr,
  inrExact,
  inrCompact,
  pct,
  marginPct,
  fmtDate,
  fmtDateTime,
  daysSince,
  dateInput,
  capitalizeWords,
  titleCase,
} from './format';

describe('inr', () => {
  it('formats whole rupees with Indian grouping', () => {
    expect(inr(2336000)).toBe('₹23,360');
  });
  it('rounds to the nearest rupee', () => {
    expect(inr(150)).toBe('₹2'); // 1.5 rounds up
    expect(inr(149)).toBe('₹1');
  });
  it('handles zero', () => {
    expect(inr(0)).toBe('₹0');
  });
  it('handles a large amount with correct Indian digit grouping', () => {
    expect(inr(186400000000)).toBe('₹1,86,40,00,000');
  });
  it('renders an em dash for null or undefined', () => {
    expect(inr(null)).toBe('—');
    expect(inr(undefined)).toBe('—');
  });
  it('handles negative values (e.g. a penalty credit) — sign lands next to the digits, not the ₹', () => {
    expect(inr(-500000)).toBe('₹-5,000');
  });
});

describe('inrExact', () => {
  it('keeps the paise as a fraction of a rupee', () => {
    expect(inrExact(150)).toBe('₹1.5');
  });
  it('renders an em dash for null or undefined', () => {
    expect(inrExact(null)).toBe('—');
    expect(inrExact(undefined)).toBe('—');
  });
});

describe('inrCompact', () => {
  it('falls back to inr() below one lakh', () => {
    expect(inrCompact(9999900)).toBe('₹99,999');
  });
  it('renders lakhs between 1L and 1Cr', () => {
    expect(inrCompact(140000000)).toBe('₹14.0 L');
  });
  it('renders crores at 1Cr and above', () => {
    expect(inrCompact(186400000000)).toBe('₹186.40 Cr');
  });
  it('treats exactly one lakh as the lakh boundary', () => {
    expect(inrCompact(10000000)).toBe('₹1.0 L');
  });
  it('treats exactly one crore as the crore boundary', () => {
    expect(inrCompact(1000000000)).toBe('₹1.00 Cr');
  });
  it('renders an em dash for null or undefined', () => {
    expect(inrCompact(null)).toBe('—');
  });
});

describe('pct', () => {
  it('formats to one decimal by default', () => {
    expect(pct(40)).toBe('40.0%');
  });
  it('respects a custom digit count', () => {
    expect(pct(40.567, 2)).toBe('40.57%');
  });
  it('renders an em dash for null, undefined, or NaN', () => {
    expect(pct(null)).toBe('—');
    expect(pct(undefined)).toBe('—');
    expect(pct(NaN)).toBe('—');
  });
});

describe('marginPct', () => {
  it('computes margin as a percentage of revenue', () => {
    expect(marginPct(100000, 80000)).toBe(20);
  });
  it('returns 0 when revenue is 0 (avoids divide-by-zero)', () => {
    expect(marginPct(0, 5000)).toBe(0);
  });
  it('can be negative when cost exceeds revenue', () => {
    expect(marginPct(100000, 120000)).toBe(-20);
  });
});

describe('fmtDate / fmtDateTime', () => {
  it('formats an ISO date in en-IN day-month-year', () => {
    expect(fmtDate('2026-08-14T00:00:00+05:30')).toBe('14 Aug 2026');
  });
  it('renders an em dash for a null/undefined/empty date', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate(undefined)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });
  it('formats date + time in 24h form', () => {
    expect(fmtDateTime('2026-08-11T06:05:00+05:30')).toBe('11 Aug, 06:05');
  });
});

describe('daysSince', () => {
  it('returns null for a missing timestamp', () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince(undefined)).toBeNull();
  });
  it('returns 0 for a timestamp a few hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    expect(daysSince(twoHoursAgo)).toBe(0);
  });
  it('returns whole days elapsed for an older timestamp', () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000 - 1000).toISOString();
    expect(daysSince(tenDaysAgo)).toBe(10);
  });
});

describe('dateInput', () => {
  it('reduces an ISO timestamp to YYYY-MM-DD', () => {
    expect(dateInput('2026-08-14T18:40:00.000Z')).toBe('2026-08-14');
  });
  it('returns an empty string for a missing value', () => {
    expect(dateInput(null)).toBe('');
    expect(dateInput(undefined)).toBe('');
  });
});

describe('capitalizeWords', () => {
  it('title-cases free-typed, inconsistently-cased names', () => {
    expect(capitalizeWords('rathod  roadlines')).toBe('Rathod Roadlines');
  });
  it('handles already-correct casing idempotently', () => {
    expect(capitalizeWords('Sai Kripa Carriers')).toBe('Sai Kripa Carriers');
  });
  it('collapses extra internal whitespace', () => {
    expect(capitalizeWords('  bhagwati   logistics  ')).toBe('Bhagwati Logistics');
  });
  it('handles an empty string without throwing', () => {
    expect(capitalizeWords('')).toBe('');
  });
});

describe('titleCase', () => {
  it('converts an ENUM_STYLE value into Title Case words', () => {
    expect(titleCase('ONLY_ABOVE_BAND_QUOTES')).toBe('Only Above Band Quotes');
  });
  it('handles a single-word enum', () => {
    expect(titleCase('PENDING')).toBe('Pending');
  });
});
