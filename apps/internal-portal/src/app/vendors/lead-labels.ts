/**
 * Where a lead came from, in the words someone would say out loud. The stored
 * values stay the enum the server and the fixtures already use; only the
 * reading changes — nobody should have to decode MARKET_GAP on a screen.
 */
export const LEAD_SOURCES: { value: string; label: string }[] = [
  { value: 'FIELD', label: 'Met in the field' },
  { value: 'REFERRAL', label: 'Referred to us' },
  { value: 'MARKET_GAP', label: 'A lane we cannot cover' },
  { value: 'INBOUND', label: 'They called us' },
];

export function leadSourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return LEAD_SOURCES.find((s) => s.value === source)?.label ?? source.replace(/_/g, ' ').toLowerCase();
}
