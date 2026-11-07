/**
 * The state a GSTIN was issued in — its first two digits are the GST state
 * code. The lorry receipt prints a State beside each party's GSTIN; when
 * nobody typed one, this is what the GSTIN already says.
 */
const GST_STATE: Record<string, string> = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
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
