/**
 * Code 39, the symbology the LR barcode is scanned with at checkposts
 * (part 05 §2). Nine elements per character, bar first, alternating
 * bar/space; wide elements are `WIDE_RATIO` narrow units. `*` delimits.
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
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', $: 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

const NARROW = 1;
const WIDE_RATIO = 3;

export interface Code39 {
  bars: { x: number; width: number }[];
  width: number;
}

/** Unsupported characters are dropped rather than throwing on a live screen. */
export function code39(value: string): Code39 {
  const chars = ['*', ...value.toUpperCase().split('').filter((c) => PATTERNS[c]), '*'];
  const bars: { x: number; width: number }[] = [];
  let x = 0;

  chars.forEach((char, ci) => {
    PATTERNS[char].split('').forEach((el, i) => {
      const width = el === 'w' ? NARROW * WIDE_RATIO : NARROW;
      if (i % 2 === 0) bars.push({ x, width }); // even index = bar, odd = space
      x += width;
    });
    if (ci < chars.length - 1) x += NARROW; // inter-character gap
  });

  return { bars, width: x };
}
