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

/**
 * Mirrors `PortalProfileDto` (`portal.dto.ts`). `contactName`, `panMasked`,
 * `aadhaarLast4`, `bankAccountMasked` and `bankIfsc` are all genuinely
 * nullable there — `vendors.ifsc`/`account_holder` are optional columns
 * (`db/types.ts`) and the PAN/Aadhaar/account maskers each return `null` on an
 * unset source value (`portal-profile.service.ts`). Declaring them required
 * here rendered the literal string "null" (e.g. "Contact: null · …") for any
 * vendor missing one of these before it is on file — the same bug class
 * `Load`/`Trip`'s `distanceKm` already documents.
 */
export interface Profile {
  vendorCode: string;
  companyName: string;
  contactName: string | null;
  phone: string;
  city: string;
  gstin: string | null;
  panMasked: string | null;
  /** `BR-04`, `NFR-04` — last four digits only, never the full number. */
  aadhaarLast4: string | null;
  bankAccountMasked: string | null;
  bankIfsc: string | null;
  advancePolicyPct: number;
  business: { trips: number; valuePaise: number; outstandingPaise: number };
  documents: { group: string; documents: VendorDocument[] }[];
}
