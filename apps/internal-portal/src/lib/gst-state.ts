import { GST_STATES } from './manual-invoice';

/**
 * The state a GSTIN was issued in — its first two digits are the GST state
 * code. The lorry receipt prints a State beside each party's GSTIN; when
 * nobody typed one, this is what the GSTIN already says.
 *
 * The codes are the one list shared with invoices and the API
 * (internal-api/src/common/manual-invoice.ts), plus 28: Andhra Pradesh's code
 * before 2014, still on some older registrations.
 */
const GST_STATE: Record<string, string> = {
  ...Object.fromEntries(GST_STATES.map((s) => [s.code, s.name])),
  '28': 'Andhra Pradesh',
};

/** "37AAKCN9322K1ZY" → "Andhra Pradesh"; '' when there is no GSTIN or the code is unknown. */
export function stateFromGstin(gstin: string | null | undefined): string {
  const code = String(gstin ?? '').trim().slice(0, 2);
  return GST_STATE[code] ?? '';
}

/** The state to print for a party: the one typed, else the one its GSTIN names. */
export function partyState(party: { state?: string | null; gstin?: string | null } | null | undefined): string {
  return (party?.state ?? '').trim() || stateFromGstin(party?.gstin);
}
