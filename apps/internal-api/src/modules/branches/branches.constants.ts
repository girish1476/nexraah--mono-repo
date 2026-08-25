/**
 * Where a branch or a lane actually gets its vehicles from.
 *
 * `BOTH` is not a tidy-up of the other two — it is the common case, and the
 * one an operator most needs to record, because a lane served by both the
 * union and the open market prices and fails differently from either alone.
 */
export const SUPPLY_SOURCES = ['UNION', 'MARKET', 'BOTH', 'DIRECT_OWNER'] as const;

export type SupplySourceCode = (typeof SUPPLY_SOURCES)[number];

export const SUPPLY_SOURCE_LABEL: Record<SupplySourceCode, string> = {
  UNION: 'Transport union',
  MARKET: 'Open market',
  BOTH: 'Union and market',
  DIRECT_OWNER: 'Direct owners',
};
