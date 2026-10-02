/** Mirrors `apps/internal-api/src/modules/targets/`. */

export const TARGET_METRICS = ['LOADS', 'REVENUE', 'MARGIN', 'COLLECTIONS', 'PODS'] as const;

export type TargetMetric = (typeof TARGET_METRICS)[number];

/** LOADS and PODS are counted; the rest are money, in paise. */
export type TargetUnit = 'COUNT' | 'PAISE';

export const TARGET_UNIT: Record<TargetMetric, TargetUnit> = {
  LOADS: 'COUNT',
  REVENUE: 'PAISE',
  MARGIN: 'PAISE',
  COLLECTIONS: 'PAISE',
  PODS: 'COUNT',
};

export const TARGET_LABEL: Record<TargetMetric, string> = {
  LOADS: 'Loads delivered',
  REVENUE: 'Billed to clients',
  MARGIN: 'Margin kept',
  COLLECTIONS: 'Collected from clients',
  PODS: 'Delivery proofs approved',
};

export const TARGET_EMOJI: Record<TargetMetric, string> = {
  LOADS: '🚚',
  REVENUE: '🧾',
  MARGIN: '📈',
  COLLECTIONS: '📥',
  PODS: '📸',
};

/** Which desk a measure is shown to, for the screen where targets are entered. */
export const TARGET_DESK: Record<TargetMetric, string> = {
  LOADS: 'Operations',
  REVENUE: 'Business development',
  MARGIN: 'Operations',
  COLLECTIONS: 'Finance',
  PODS: 'Compliance',
};

export interface TargetProgress {
  /** Null when nobody has set one for the period. */
  target: number | null;
  achieved: number;
}

/** `GET /targets/desk` — the caller's own measures, for this month and this quarter. */
export interface DeskTargets {
  /** `YYYY-MM`. */
  month: string;
  quarter: { from: string; to: string };
  /** The branch these figures are for, or null when they cover every branch. */
  branchName: string | null;
  targets: { metric: TargetMetric; unit: TargetUnit; month: TargetProgress; quarter: TargetProgress }[];
}

/** `GET /targets?month=` — every branch, and what has been set for it that month. */
export interface MonthTargets {
  month: string;
  rows: { branchId: string; branchName: string; targets: Record<TargetMetric, number | null> }[];
}
