/**
 * Money is bigint paise everywhere on the wire (NFR-09). Nothing in this
 * file rounds — it formats. Rupee rounding happens once, server-side, at the
 * invoice total (`invoices.round_off`).
 */

export type Paise = number;

const inrGroup = new Intl.NumberFormat('en-IN');

/** 2336000 → "₹23,360" */
export function inr(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const rupees = paise / 100;
  return `₹${inrGroup.format(Math.round(rupees))}`;
}

/** Keeps the paise when they matter — penalties, charge lines. */
export function inrExact(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  return `₹${inrGroup.format(paise / 100)}`;
}

/** 1860000000 → "₹1.86 Cr". Summary tiles only, never a payable figure. */
export function inrCompact(paise: Paise | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 1e7) return `₹${(rupees / 1e7).toFixed(2)} Cr`;
  if (Math.abs(rupees) >= 1e5) return `₹${(rupees / 1e5).toFixed(1)} L`;
  return inr(paise);
}

export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function marginPct(revenuePaise: Paise, costPaise: Paise): number {
  if (!revenuePaise) return 0;
  return ((revenuePaise - costPaise) / revenuePaise) * 100;
}

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function fmtDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : '—';
}

export function fmtDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : '—';
}

/** Whole days elapsed since an ISO timestamp. */
export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 86_400_000);
}

/** Input value for `<input type="date">`. */
export function dateInput(iso: string | null | undefined): string {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '';
}

/** "rathod  roadlines" → "Rathod Roadlines" — free-text names typed in any case. */
export function capitalizeWords(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
