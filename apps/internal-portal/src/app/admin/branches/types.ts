/** Branches — `/admin/branches` · `config.manage`. */

/**
 * Where a branch gets its vehicles. `BOTH` is the common case, not a
 * tidy-up — a lane served by union and market together prices and fails
 * differently from either on its own.
 */
export const SUPPLY_SOURCES = ['UNION', 'MARKET', 'BOTH', 'DIRECT_OWNER'] as const;

export type SupplySource = (typeof SUPPLY_SOURCES)[number];

export const SUPPLY_SOURCE_LABEL: Record<SupplySource, string> = {
  UNION: 'Transport union',
  MARKET: 'Open market',
  BOTH: 'Union and market',
  DIRECT_OWNER: 'Direct owners',
};

export interface Branch {
  id: string;
  code: string;
  name: string;
  city: string;
  catchmentKm: number;
  supplySource: SupplySource | null;
  supplySourceLabel: string | null;
  supplyRemarks: string | null;
}

export interface BranchDraft {
  name: string;
  city: string;
  code?: string;
  catchmentKm?: number;
  supplySource?: SupplySource;
  supplyRemarks?: string;
}

export interface BranchPatch {
  name?: string;
  city?: string;
  catchmentKm?: number;
  supplySource?: SupplySource | null;
  supplyRemarks?: string | null;
}
