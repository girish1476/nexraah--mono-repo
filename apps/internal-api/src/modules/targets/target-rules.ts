/**
 * What a target is measured in, and which desk is held to which measure.
 *
 * Kept free of Nest and the database so the portal's fixture can import the
 * same rules rather than keep a second copy that drifts.
 */

export const TARGET_METRICS = ['LOADS', 'REVENUE', 'MARGIN', 'COLLECTIONS', 'PODS'] as const;

export type TargetMetric = (typeof TARGET_METRICS)[number];

/** LOADS and PODS are counted; the rest are money, in paise. */
export const TARGET_UNIT: Record<TargetMetric, 'COUNT' | 'PAISE'> = {
  LOADS: 'COUNT',
  REVENUE: 'PAISE',
  MARGIN: 'PAISE',
  COLLECTIONS: 'PAISE',
  PODS: 'COUNT',
};

/**
 * The measures each desk sees on My desk. Leadership and Administration
 * oversee every desk, so they see every measure. A custom role is read as the
 * built-in role it is based on.
 */
const ROLE_METRICS: Record<string, readonly TargetMetric[]> = {
  OPS: ['LOADS', 'MARGIN'],
  LOADING_SUPERVISOR: ['LOADS'],
  BD: ['REVENUE'],
  FINANCE: ['COLLECTIONS'],
  COMPLIANCE: ['PODS'],
  LEADERSHIP: TARGET_METRICS,
  ADMIN: TARGET_METRICS,
};

export function metricsForRole(role: string): readonly TargetMetric[] {
  return ROLE_METRICS[role] ?? [];
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value);
}

/** The month it is in India right now, as `YYYY-MM` — the business runs on IST, the server may not. */
export function currentMonth(now: Date = new Date()): string {
  return new Date(now.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 7);
}

/** `YYYY-MM` moved by a number of months. */
export function addMonths(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** The first of a month, as the date the database keeps. */
export function monthStart(month: string): string {
  return `${month}-01`;
}

/**
 * The quarter a month falls in: Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec. The
 * calendar and the financial year cut their quarters at the same months, so
 * this is right for either.
 */
export function quarterOf(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const first = Math.floor((m - 1) / 3) * 3 + 1;
  const from = `${y}-${String(first).padStart(2, '0')}`;
  return { from, to: addMonths(from, 2) };
}
