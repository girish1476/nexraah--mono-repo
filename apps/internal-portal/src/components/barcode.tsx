'use client';

/**
 * Code 39 barcode as inline SVG — the LR and invoice prints carry one
 * (FSD B6). Code 39 is used because it needs no checksum, encodes the
 * character set our numbers use, and every warehouse scanner reads it.
 *
 * Bar layout comes from `lib/barcode-pattern.ts`, shared with the
 * downloadable invoice PDF so both draw the same bars.
 */

import { barcodeBars } from '@/lib/barcode-pattern';

export function Barcode({ value, height = 44, narrow = 1.6 }: { value: string; height?: number; narrow?: number }) {
  const { bars, width } = barcodeBars(value, narrow);

  return (
    <svg width={width} height={height + 12} role="img" aria-label={`Barcode ${value}`}>
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#000" />
      ))}
      <text x={0} y={height + 10} fontSize="9" fontFamily="monospace">
        {value}
      </text>
    </svg>
  );
}
