import { describe, it, expect } from 'vitest';
import { LOAD_TONE, BAND_TONE, QUOTE_TONE, TRIP_TONE, POD_TONE, VEHICLE_TONE, DOCUMENT_TONE } from './status';

describe('LOAD_TONE', () => {
  it('is blue once the vendor has quoted', () => {
    expect(LOAD_TONE(true)).toBe('blue');
  });
  it('is grey while still open', () => {
    expect(LOAD_TONE(false)).toBe('grey');
  });
});

describe('BAND_TONE', () => {
  it('is red when below the band (would be rejected)', () => {
    expect(BAND_TONE(true, false)).toBe('red');
  });
  it('is flag when above the band (needs approval)', () => {
    expect(BAND_TONE(false, true)).toBe('flag');
  });
  it('is mint when within the band', () => {
    expect(BAND_TONE(false, false)).toBe('mint');
  });
  it('below takes precedence over above if both were somehow true', () => {
    expect(BAND_TONE(true, true)).toBe('red');
  });
});

describe('status tone maps use only the five defined tones', () => {
  const VALID = new Set(['mint', 'blue', 'flag', 'red', 'grey']);
  it.each([
    ['QUOTE_TONE', QUOTE_TONE],
    ['TRIP_TONE', TRIP_TONE],
    ['POD_TONE', POD_TONE],
    ['VEHICLE_TONE', VEHICLE_TONE],
    ['DOCUMENT_TONE', DOCUMENT_TONE],
  ])('%s', (_name, map) => {
    for (const tone of Object.values(map)) {
      expect(VALID.has(tone as string)).toBe(true);
    }
  });

  it('a WON quote reads as settled (mint), a LOST one as fix-it (red)', () => {
    expect(QUOTE_TONE.WON).toBe('mint');
    expect(QUOTE_TONE.LOST).toBe('red');
  });
  it('a rejected POD is red, an approved one is mint', () => {
    expect(POD_TONE.REJECTED).toBe('red');
    expect(POD_TONE.APPROVED).toBe('mint');
  });
});
