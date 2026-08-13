'use client';

/**
 * Code 39 barcode as inline SVG — the LR and invoice prints carry one
 * (FSD B6). Code 39 is used because it needs no checksum, encodes the
 * character set our numbers use, and every warehouse scanner reads it.
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

export function Barcode({ value, height = 44, narrow = 1.6 }: { value: string; height?: number; narrow?: number }) {
  const text = `*${value.toUpperCase().replace(/[^0-9A-Z\-. ]/g, '-')}*`;
  const bars: { x: number; w: number }[] = [];
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

  return (
    <svg width={x} height={height + 12} role="img" aria-label={`Barcode ${value}`}>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
      <text x={0} y={height + 10} fontSize="9" fontFamily="monospace">
        {value}
      </text>
    </svg>
  );
}
