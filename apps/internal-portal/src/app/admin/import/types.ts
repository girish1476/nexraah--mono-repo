/** Go-live import — part 12. Three sets, in a fixed order. */

export type ImportSet = 'clients' | 'vendors' | 'opening-balances';

export interface DryRunReport {
  rowCount: number;
  rejects: { row: number; reason: string }[];
  /** Opening balances only — a mismatch aborts the entire import. */
  controlTotals: { suppliedPaise: number; computedPaise: number; reconciles: boolean } | null;
}

export interface ImportBatch {
  id: string;
  set: ImportSet;
  fileName: string;
  fileHash: string;
  rows: number;
  rejected: number;
  actor: string;
  committedAt: string | null;
  status: 'DRY_RUN' | 'COMMITTED' | 'ABORTED';
  report?: DryRunReport;
}
