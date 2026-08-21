/**
 * The eleven trip documents of part 05 §3, in the five groups the documents
 * tab renders. Eight of them gate the advance (BR-58) — but the authoritative
 * set is `config.advance_document_set`, read from the server, never this file.
 */

export type DocGroup = 'CLIENT' | 'VEHICLE' | 'DRIVER' | 'LR' | 'POD';

export const DOC_LABELS: Record<string, string> = {
  CLIENT_INVOICE_OR_PO: 'Client invoice or purchase order',
  EWAY_BILL: 'E-way bill',
  RC: 'Registration certificate',
  INSURANCE: 'Goods insurance',
  FITNESS: 'Fitness certificate',
  PERMIT: 'National permit',
  PUC: 'Pollution certificate',
  DRIVING_LICENCE: 'Driving licence',
  LR: 'Lorry receipt',
  POD: 'Proof of delivery',
};

export const DOC_GROUPS: { key: DocGroup; label: string; kinds: string[] }[] = [
  { key: 'CLIENT', label: 'Client', kinds: ['CLIENT_INVOICE_OR_PO', 'EWAY_BILL'] },
  { key: 'VEHICLE', label: 'Vehicle', kinds: ['RC', 'INSURANCE', 'FITNESS', 'PERMIT', 'PUC'] },
  { key: 'DRIVER', label: 'Driver', kinds: ['DRIVING_LICENCE'] },
  { key: 'LR', label: 'Lorry receipt', kinds: ['LR'] },
  { key: 'POD', label: 'Proof of delivery', kinds: ['POD'] },
];

export const VENDOR_KYC_KINDS: { kind: string; label: string }[] = [
  { kind: 'PAN', label: 'PAN number and card photograph' },
  { kind: 'AADHAAR', label: 'Aadhaar OTP and card photograph' },
  { kind: 'ADDRESS', label: 'Address proof' },
  { kind: 'SELFIE', label: 'Geo-stamped selfie at the yard' },
];

export const VENDOR_DOC_KINDS: { kind: string; label: string; note?: string }[] = [
  { kind: 'RC', label: 'Registration certificate', note: 'Mandatory for an Owner (BR-02)' },
  { kind: 'TRADE_LICENCE', label: 'Trade licence' },
  { kind: 'LABOUR_LICENCE', label: 'Labour licence' },
  { kind: 'UDYAM', label: 'Udyam / MSME certificate' },
  { kind: 'TDS_DECLARATION', label: 'TDS declaration', note: 'Mandatory for every party type (BR-03)' },
  { kind: 'BANK_STATEMENT', label: 'Bank statement or cancelled cheque' },
  { kind: 'TRANSPORTER_AGREEMENT', label: 'Signed transporter agreement' },
];

export const CHARGE_TYPES = ['LOADING', 'UNLOADING', 'LABOUR', 'HALT', 'DETENTION', 'OTHER'] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];

export const PAYMENT_MODES = ['NEFT', 'RTGS', 'IMPS', 'UPI', 'CHEQUE', 'CASH'] as const;
export const TRANSFER_TYPES = ['VENDOR_ACCOUNT', 'DRIVER_ACCOUNT', 'FUEL_CARD', 'CASH_AT_BRANCH'] as const;

/** The POD chain of BR-48, coloured once so every screen agrees. */
export const POD_TONE: Record<string, 'mint' | 'flag' | 'red' | 'blue' | 'grey'> = {
  PENDING: 'red',
  ATTACHED: 'flag',
  RECEIVED: 'blue',
  VERIFIED: 'blue',
  APPROVED: 'mint',
  WAIVED: 'mint',
  FORFEITED: 'red',
};

export function docLabel(kind: string): string {
  return DOC_LABELS[kind] ?? kind.replace(/_/g, ' ').toLowerCase();
}

/**
 * The five telematics alert kinds of `BR-19` (part 11 §1), coloured once so
 * the fleet board and a trip's own tracking panel agree.
 */
export const ALERT_LABEL: Record<string, string> = {
  OVERSPEED: 'Overspeed',
  LONG_HALT: 'Long halt',
  DARK_VEHICLE: 'No signal',
  EWAY_EXPIRING: 'E-way expiring',
  EWAY_EXPIRED: 'E-way expired',
};

export const ALERT_TONE: Record<string, 'mint' | 'flag' | 'red' | 'blue' | 'grey'> = {
  OVERSPEED: 'red',
  LONG_HALT: 'flag',
  DARK_VEHICLE: 'flag',
  EWAY_EXPIRING: 'flag',
  EWAY_EXPIRED: 'red',
};
