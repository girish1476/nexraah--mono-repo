export type DocumentGroup = 'CLIENT' | 'VEHICLE' | 'DRIVER' | 'LR' | 'POD';

export interface DocumentKindMeta {
  kind: string;
  label: string;
  group: DocumentGroup;
}

/**
 * docs/api/04-trips-lr.md's document group table, ten kinds (the "eleven" in
 * both spec files' prose doesn't match either file's own table — see
 * migration 20260814090600's note). `gatesAdvance` is NOT baked in here — the
 * service computes it live against `config.advance_document_set`.
 */
export const TRIP_DOCUMENT_KINDS: DocumentKindMeta[] = [
  { kind: 'CLIENT_INVOICE_OR_PO', label: 'Client invoice or purchase order', group: 'CLIENT' },
  { kind: 'EWAY_BILL', label: 'E-way bill', group: 'CLIENT' },
  { kind: 'RC', label: 'Registration certificate', group: 'VEHICLE' },
  { kind: 'INSURANCE', label: 'Goods insurance', group: 'VEHICLE' },
  { kind: 'FITNESS', label: 'Fitness certificate', group: 'VEHICLE' },
  { kind: 'PERMIT', label: 'Permit', group: 'VEHICLE' },
  { kind: 'PUC', label: 'Pollution certificate', group: 'VEHICLE' },
  { kind: 'DRIVING_LICENCE', label: 'Driving licence', group: 'DRIVER' },
  { kind: 'LR', label: 'Lorry receipt', group: 'LR' },
  { kind: 'POD', label: 'Proof of delivery', group: 'POD' },
];

export const CHARGE_TYPES = ['LOADING', 'UNLOADING', 'LABOUR', 'HALT', 'DETENTION', 'OTHER'];
