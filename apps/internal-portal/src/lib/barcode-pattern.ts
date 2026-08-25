/**
 * Code 39 bar encoding — shared by the on-screen/print SVG barcode
 * (`components/barcode.tsx`) and the downloadable invoice PDF
 * (`lib/invoice-pdf.ts`) so both draw from the same table instead of two
 * copies drifting apart.
 *
 * Nine elements per character, three of them wide. `narrow` is the module
 * width; wide bars are three modules.
 */

const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', A: 'wnnnnwnnw', B: 'nnwnnwnnw',
  C: 'wnwnnwnnn', D: 'nnnnwwnnw', E: 'wnnnwwnnn', F: 'nnwnwwnnn',
  G: 'nnnnnwwnw', H: 'wnnnnwwnn', I: 'nnwnnwwnn', J: 'nnnnwwwnn',
  K: 'wnnnnnnww', L: 'nnwnnnnww', M: 'wnwnnnnwn', N: 'nnnnwnnww',
  O: 'wnnnwnnwn', P: 'nnwnwnnwn', Q: 'nnnnnnwww', R: 'wnnnnnwwn',
  S: 'nnwnnnwwn', T: 'nnnnwnwwn', U: 'wwnnnnnnw', V: 'nwwnnnnnw',
  W: 'wwwnnnnnn', X: 'nwnnwnnnw', Y: 'wwnnwnnnn', Z: 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '*': 'nwnnwnwnn',
};

export interface Bar {
  x: number;
  w: number;
}

/** Bars for `value` at the given module width, plus the total drawn width. */
export function barcodeBars(value: string, narrow: number): { bars: Bar[]; width: number } {
  const text = `*${value.toUpperCase().replace(/[^0-9A-Z\-. ]/g, '-')}*`;
  const bars: Bar[] = [];
  let x = 0;

  for (const char of text) {
    const pattern = PATTERNS[char] ?? PATTERNS['-'];
    pattern.split('').forEach((element, i) => {
      const w = element === 'w' ? narrow * 3 : narrow;
      if (i % 2 === 0) bars.push({ x, w }); // even index = bar, odd = space
      x += w;
    });
    x += narrow; // inter-character gap
  }

  return { bars, width: x };
}
