export type DocumentStatus = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export const DOCUMENT_STATUS_LABEL: Record<DocumentStatus, string> = {
  MISSING: 'Not uploaded',
  PENDING: 'With compliance',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
};

export interface VendorDocument {
  kind: string;
  label: string;
  status: DocumentStatus;
  /** Present when REJECTED — the whole point of this screen (part 08 §1). */
  rejectionReason: string | null;
  rejectedOn: string | null;
  expiredOn: string | null;
  /** Present when an expiry grounds a truck (`DOCS_DUE`, part 04 §2). */
  groundsVehicleRegistrationNo: string | null;
  /** Opens the phone camera in a mobile browser. */
  capture: boolean;
  /** Selfie only — coordinates go onto the attachment record. */
  needsGeotag: boolean;
}

export interface Profile {
  vendorCode: string;
  companyName: string;
  contactName: string;
  phone: string;
  city: string;
  gstin: string | null;
  panMasked: string;
  /** `BR-04`, `NFR-04` — last four digits only, never the full number. */
  aadhaarLast4: string;
  bankAccountMasked: string;
  bankIfsc: string;
  advancePolicyPct: number;
  business: { trips: number; valuePaise: number; outstandingPaise: number };
  documents: { group: string; documents: VendorDocument[] }[];
}
