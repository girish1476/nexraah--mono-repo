export const KYC_KINDS = ['PAN', 'AADHAAR', 'ADDRESS', 'SELFIE'] as const;
export type KycKind = (typeof KYC_KINDS)[number];

export const DOCUMENT_KINDS = [
  'TRADE_LICENCE',
  'LABOUR_LICENCE',
  'RC',
  'UDYAM',
  'TDS_DECLARATION',
  'BANK_STATEMENT',
  'TRANSPORTER_AGREEMENT',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// BR-02: RC is mandatory for an Owner; a Vendor needs at least one of these four.
export const LEGAL_DOCUMENT_KINDS: DocumentKind[] = ['TRADE_LICENCE', 'LABOUR_LICENCE', 'RC', 'UDYAM'];

// BR-03: every party type, no exception — held on file, nothing deducted (BR-33).
export const ALWAYS_MANDATORY_DOCUMENT_KINDS: DocumentKind[] = ['TDS_DECLARATION', 'BANK_STATEMENT'];

// step 2 of the wizard (internal-spec/03-C2 §1): all four are ●.
export const MANDATORY_KYC_KINDS: KycKind[] = ['PAN', 'AADHAAR', 'ADDRESS', 'SELFIE'];

// NFR-04: identity images (the card photo behind PAN/AADHAAR, plus the selfie
// and address proof) are COMPLIANCE-only — same rule attachments.service.ts
// already applies by `vendor_kyc.kind`.
export const IDENTITY_KYC_KINDS = new Set<string>(['PAN', 'AADHAAR', 'ADDRESS', 'SELFIE']);
