/**
 * A transporter's licence or registration (BR-02). An Owner needs the RC;
 * anyone else needs any one of these four, so the vendor file asks for one,
 * with a choice of which, instead of four separate uploads. The same four as
 * the server's `LEGAL_DOCUMENT_KINDS` (internal-api vendors.constants.ts).
 */
export const LEGAL_DOCUMENT_KINDS: { kind: string; label: string }[] = [
  { kind: 'TRADE_LICENCE', label: 'Trade licence' },
  { kind: 'LABOUR_LICENCE', label: 'Labour licence' },
  { kind: 'RC', label: 'Registration certificate (RC)' },
  { kind: 'UDYAM', label: 'Udyam / MSME certificate' },
];

export const isLegalDocument = (kind: string) => LEGAL_DOCUMENT_KINDS.some((l) => l.kind === kind);

interface Check {
  kind: string;
  status: string;
}

export interface VendorFileGap {
  key: string;
  label: string;
  state: 'MISSING' | 'UNVERIFIED';
}

/**
 * What still stands between a transporter and activation. Every identity check
 * and every other paper must be verified. Of the four legal papers only the
 * one BR-02 asks for is needed; one that is uploaded but not yet decided must
 * still be verified or rejected, and one rejected or never uploaded is not
 * asked for while another stands in for it.
 */
export function vendorFileGaps(
  vendor: { partyType: string; kyc: Check[]; documents: Check[] },
  docName: (kind: string) => string,
): VendorFileGap[] {
  const gap = (key: string, name: string, status: string): VendorFileGap => ({
    key,
    label: `${name} ${status === 'MISSING' ? 'not on file' : status.toLowerCase()}`,
    state: status === 'MISSING' ? 'MISSING' : 'UNVERIFIED',
  });
  const gaps: VendorFileGap[] = vendor.kyc
    .filter((k) => k.status !== 'VERIFIED')
    .map((k) => ({ key: k.kind, label: `${k.kind} not verified`, state: k.status === 'MISSING' ? 'MISSING' : 'UNVERIFIED' }));

  for (const d of vendor.documents) {
    if (isLegalDocument(d.kind) || d.status === 'VERIFIED') continue;
    gaps.push(gap(d.kind, docName(d.kind), d.status));
  }

  const legal = vendor.documents.filter((d) => isLegalDocument(d.kind));
  for (const d of legal) {
    if (d.status === 'PENDING') gaps.push(gap(d.kind, docName(d.kind), d.status));
  }
  if (vendor.partyType === 'OWNER') {
    const rc = legal.find((d) => d.kind === 'RC');
    if (rc?.status !== 'VERIFIED' && rc?.status !== 'PENDING') gaps.push(gap('RC', docName('RC'), rc?.status ?? 'MISSING'));
  } else if (!legal.some((d) => d.status === 'VERIFIED' || d.status === 'PENDING')) {
    gaps.push({
      key: 'LEGAL_DOCUMENT',
      label: 'No licence or registration on file — any one of trade licence, labour licence, RC or Udyam',
      state: 'MISSING',
    });
  }
  return gaps;
}
