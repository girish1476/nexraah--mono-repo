import { describe, it, expect } from 'vitest';
import { csvCell, toCsv, todayStamp } from './export-csv';

describe('csvCell', () => {
  it('leaves plain text and numbers alone', () => {
    expect(csvCell('Berger Paints')).toBe('Berger Paints');
    expect(csvCell(42500)).toBe('42500');
    expect(csvCell(-12.5)).toBe('-12.5');
  });

  it('writes nothing for missing values', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Mumbai, Pune')).toBe('"Mumbai, Pune"');
    expect(csvCell('the "big" one')).toBe('"the ""big"" one"');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
  });

  it('defuses text a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('+91 98300 11223')).toBe("'+91 98300 11223");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
  });
});

describe('toCsv', () => {
  it('joins headers and rows with CRLF', () => {
    expect(toCsv(['Client', 'Value'], [['A', 1], ['B, Ltd', null]])).toBe('Client,Value\r\nA,1\r\n"B, Ltd",');
  });
});

describe('todayStamp', () => {
  it('is the local calendar date, zero-padded', () => {
    expect(todayStamp(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05');
  });
});
