import { describe, it, expect } from 'vitest';
import { inr, inrRange, capitalizeWords, dateTime } from './format';

describe('inr', () => {
  it('formats whole rupees with Indian digit grouping', () => {
    expect(inr(4020000)).toBe('₹40,200');
  });
  it('rounds to the nearest rupee', () => {
    expect(inr(150)).toBe('₹2');
    expect(inr(149)).toBe('₹1');
  });
  it('handles zero', () => {
    expect(inr(0)).toBe('₹0');
  });
});

describe('inrRange', () => {
  it('renders both bounds joined by an en dash', () => {
    expect(inrRange(3800000, 4250000)).toBe('₹38,000 – ₹42,500');
  });
});

describe('capitalizeWords', () => {
  it('title-cases a lowercase city name', () => {
    expect(capitalizeWords('nashik')).toBe('Nashik');
  });
  it('title-cases every word and collapses extra whitespace', () => {
    expect(capitalizeWords('  new   delhi  ')).toBe('New Delhi');
  });
  it('handles an empty string without throwing', () => {
    expect(capitalizeWords('')).toBe('');
  });
});

describe('dateTime', () => {
  it('formats an ISO timestamp as day, short month, 24h time', () => {
    expect(dateTime('2026-08-11T06:00:00+05:30')).toBe('11 Aug, 06:00');
  });
});
