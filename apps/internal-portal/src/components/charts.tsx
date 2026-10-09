'use client';

import './charts.css';

import { ReactNode, useState } from 'react';

/**
 * The console's charts — small, plain, and drawn here rather than by a
 * charting library, so they wear the console's own type and follow its light
 * and dark themes.
 *
 * The rules they keep:
 *  - a chart for a comparison or a trend, a tile for a single number;
 *  - one hue for one series (more is not darker or brighter, just longer);
 *    two series get two fixed hues and a legend, never colour alone;
 *  - thin bars with the value written at the tip, so nothing has to be
 *    hovered to be read — hovering only adds the detail;
 *  - text is always in the console's ink, never in a series colour.
 *
 * Colours are the `--viz-*` tokens in `globals.css`.
 */

/** One headline number. */
export function StatTile({
  label,
  value,
  note,
  emoji,
  tone,
}: {
  label: string;
  value: string;
  /** A line under the value: what it is measured against, or over what period. */
  note?: string;
  emoji?: string;
  /** Only for a number that needs acting on. */
  tone?: 'warn' | 'bad';
}) {
  return (
    <div className={tone ? `viz-tile is-${tone}` : 'viz-tile'}>
      <div className="viz-tile-label">
        {emoji && <span aria-hidden>{emoji} </span>}
        {label}
      </div>
      <div className="viz-tile-value">{value}</div>
      {note && <div className="viz-tile-note">{note}</div>}
    </div>
  );
}

/** A card holding one chart: what it shows, over what, and a legend when there are two series. */
export function ChartCard({
  title,
  note,
  legend,
  children,
  wide,
}: {
  title: string;
  note?: string;
  legend?: { label: string; series: 1 | 2 }[];
  children: ReactNode;
  /** Takes the full row instead of sharing it. */
  wide?: boolean;
}) {
  return (
    <section className={wide ? 'surface viz-card is-wide' : 'surface viz-card'}>
      <header className="viz-card-head">
        <div>
          <h2>{title}</h2>
          {note && <div className="viz-card-note">{note}</div>}
        </div>
        {legend && (
          <div className="viz-legend">
            {legend.map((l) => (
              <span key={l.label}>
                <i className={`viz-swatch is-${l.series}`} aria-hidden />
                {l.label}
              </span>
            ))}
          </div>
        )}
      </header>
      {children}
    </section>
  );
}

export function ChartEmpty({ children }: { children: ReactNode }) {
  return <div className="viz-empty">{children}</div>;
}

export interface BarRow {
  label: string;
  value: number;
  /** A second measure for the same row — drawn as a second bar under the first. */
  second?: number;
  /** A row that needs acting on is marked, in words as well as colour. */
  flag?: string;
}

/**
 * Horizontal bars: compare a handful of named things. The value is written at
 * the end of each bar; hovering (or tabbing to) a row lifts it.
 */
export function HBars({
  rows,
  format,
  empty = 'Nothing to show yet.',
}: {
  rows: BarRow[];
  format: (value: number) => string;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.value, r.second ?? 0]));
  if (rows.length === 0 || rows.every((r) => !r.value && !r.second)) return <ChartEmpty>{empty}</ChartEmpty>;
  return (
    <div className="viz-hbars" role="list">
      {rows.map((r) => (
        <div key={r.label} className="viz-hbar" role="listitem" tabIndex={0}>
          <div className="viz-hbar-label" title={r.label}>
            {r.label}
            {r.flag && <span className="viz-flag">{r.flag}</span>}
          </div>
          <div className="viz-hbar-tracks">
            <div className="viz-hbar-track">
              <div className="viz-bar is-1" style={{ width: `${(r.value / max) * 100}%` }} />
              <span className="viz-hbar-value">{format(r.value)}</span>
            </div>
            {r.second !== undefined && (
              <div className="viz-hbar-track">
                <div className="viz-bar is-2" style={{ width: `${(r.second / max) * 100}%` }} />
                <span className="viz-hbar-value">{format(r.second)}</span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ColumnPoint {
  /** Short label under the column (shown for the first, the last and a few between). */
  label: string;
  /** The full name of the point, for the readout. */
  name: string;
  value: number;
}

/**
 * Columns over time: one series, one hue. Moving over the chart reads out the
 * day under the pointer; the highest column carries its value on the chart.
 * The same numbers sit in a table under "Show the numbers".
 */
export function Columns({
  points,
  format,
  unit,
  empty = 'Nothing in this period yet.',
}: {
  points: ColumnPoint[];
  format: (value: number) => string;
  /** What one column counts — "loads", for the table's heading. */
  unit: string;
  empty?: string;
}) {
  const [at, setAt] = useState<number | null>(null);
  const max = Math.max(...points.map((p) => p.value), 0);
  if (points.length === 0 || max === 0) return <ChartEmpty>{empty}</ChartEmpty>;

  const W = 1100;
  const H = 240;
  const PAD = { l: 40, r: 12, t: 22, b: 28 };
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const slot = innerW / points.length;
  const barW = Math.min(24, Math.max(3, slot - 2));
  // Clean ticks: 0, half and the top, on a top rounded up to a round number.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.max(1, Math.ceil(max / step) * step);
  const ticks = top === 1 ? [0, 1] : [0, top / 2, top];
  const y = (v: number) => PAD.t + innerH - (v / top) * innerH;
  const peak = points.reduce((best, p, i) => (p.value > points[best].value ? i : best), 0);
  const every = Math.max(1, Math.ceil(points.length / 8));
  const shown = at !== null ? points[at] : null;

  return (
    <div className="viz-columns">
      <div className="viz-readout" aria-live="polite">
        {shown ? (
          <>
            <strong>{format(shown.value)}</strong> <span>{shown.name}</span>
          </>
        ) : (
          <span>Move over the chart to read a day</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${unit} over time; highest ${format(points[peak].value)} on ${points[peak].name}`}
        onPointerLeave={() => setAt(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - box.left) / box.width) * W - PAD.l;
          const i = Math.floor(x / slot);
          setAt(i >= 0 && i < points.length ? i : null);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="viz-rule" x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />
            <text className="viz-tick" x={PAD.l - 6} y={y(t) + 3.5} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {at !== null && <rect className="viz-cross" x={PAD.l + at * slot} y={PAD.t} width={slot} height={innerH} />}
        {points.map((p, i) => {
          const h = (p.value / top) * innerH;
          const x = PAD.l + i * slot + (slot - barW) / 2;
          const r = Math.min(4, barW / 2, h);
          // Rounded at the top, square on the baseline.
          const d = `M${x},${y(0)} V${y(p.value) + r} Q${x},${y(p.value)} ${x + r},${y(p.value)} H${x + barW - r} Q${x + barW},${y(p.value)} ${x + barW},${y(p.value) + r} V${y(0)} Z`;
          return p.value > 0 ? <path key={i} className={i === at ? 'viz-col is-on' : 'viz-col'} d={d} /> : null;
        })}
        <text className="viz-peak" x={PAD.l + peak * slot + slot / 2} y={y(points[peak].value) - 5} textAnchor="middle">
          {format(points[peak].value)}
        </text>
        {points.map((p, i) =>
          // The last day is always named; a regular label too close to it would run into it.
          (i % every === 0 && points.length - 1 - i >= every) || i === points.length - 1 ? (
            <text
              key={i}
              className="viz-tick"
              // The last label ends at the chart's edge instead of being centred past it.
              x={i === points.length - 1 ? W - PAD.r : PAD.l + i * slot + slot / 2}
              y={H - 6}
              textAnchor={i === points.length - 1 ? 'end' : 'middle'}
            >
              {p.label}
            </text>
          ) : null,
        )}
      </svg>
      <details className="viz-table">
        <summary>Show the numbers</summary>
        <table className="table">
          <thead>
            <tr>
              <th>Day</th>
              <th style={{ textAlign: 'right' }}>{unit}</th>
            </tr>
          </thead>
          <tbody>
            {points
              .filter((p) => p.value > 0)
              .map((p) => (
                <tr key={p.name}>
                  <td>{p.name}</td>
                  <td className="num">{format(p.value)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** One figure against its limit or its target: a filled track, with both numbers in words. */
export function Meter({
  label,
  value,
  of,
  format,
  emoji,
}: {
  label: string;
  value: number;
  /** The target or the whole. Null when none has been set. */
  of: number | null;
  format: (value: number) => string;
  emoji?: string;
}) {
  const share = of && of > 0 ? Math.min(1, value / of) : 0;
  return (
    <div className="viz-meter">
      <div className="viz-meter-head">
        <span>
          {emoji && <span aria-hidden>{emoji} </span>}
          {label}
        </span>
        <span className="viz-meter-figures">
          <strong>{format(value)}</strong>
          {of !== null ? ` of ${format(of)}` : ' · no target set'}
        </span>
      </div>
      <div
        className="viz-meter-track"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={of ?? undefined}
        aria-valuenow={value}
      >
        <div className="viz-meter-fill" style={{ width: `${share * 100}%` }} />
      </div>
      {of !== null && of > 0 && <div className="viz-meter-note">{Math.round((value / of) * 100)}% of target</div>}
    </div>
  );
}
