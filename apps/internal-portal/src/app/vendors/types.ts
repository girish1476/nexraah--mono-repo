/** Vendors and compliance — part 03. */

export type VendorStatus =
  | 'DRAFT'
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'BLACKLISTED';

export type PartyType = 'OWNER' | 'VENDOR';
export type CheckStatus = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface VendorListRow {
  id: string;
  code: string;
  legalName: string;
  partyType: PartyType;
  baseCity: string;
  branchName: string;
  phone: string;
  status: VendorStatus;
  advancePct: number;
  fleetCount: number;
  rating: number;
  trips: number;
  /** Our margin on their work — the question the vendor page exists to answer. */
  marginPaise: number;
}

export interface KycItem {
  kind: 'PAN' | 'AADHAAR' | 'ADDRESS' | 'SELFIE';
  /** BR-04 — for AADHAAR this is the last four digits and nothing more. Null while `status === 'MISSING'`. */
  valueMasked: string | null;
  /** Null while `status === 'MISSING'` — nothing has been submitted to have a route. */
  route: 'API' | 'MANUAL' | null;
  status: CheckStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  /** Set only while `status === 'REJECTED'` — cleared on the next re-upload. */
  rejectReason: string | null;
  /**
   * Where the photo was taken — the point of the geo-stamped selfie (BR-23).
   * Null for kinds that never carry one and for uploads from before the
   * coordinates were persisted (they were collected and dropped until
   * 2026-09-02). Optional so older fixtures without the field still typecheck.
   */
  geo?: { lat: number; lng: number } | null;
}

export interface VendorDocument {
  kind: string;
  reference: string | null;
  status: CheckStatus;
  validTo: string | null;
  attachmentId: string | null;
  /** Set only while `status === 'REJECTED'` — cleared on the next re-upload. */
  rejectReason: string | null;
}

export interface AdvanceHistoryRow {
  oldPct: number | null;
  newPct: number;
  changedBy: string;
  changedAt: string;
  approvalId: string | null;
}

export interface FleetRow {
  registration: string;
  type: string;
  capacityTn: number;
  bodyType: string;
  currentCity: string;
  status: 'AVAILABLE' | 'ON_TRIP' | 'DOCS_DUE' | 'MAINTENANCE';
}

export interface VendorDetail {
  id: string;
  code: string;
  legalName: string;
  partyType: PartyType;
  baseCity: string;
  branchId: string;
  branchName: string;
  gstin: string | null;
  pan: string;
  phone: string;
  altPhone: string | null;
  truckTypes: string[];
  operatingStates: string[];
  advancePct: number;
  bankAccount: string;
  ifsc: string;
  accountHolder: string;
  status: VendorStatus;
  verifiedBy: string | null;
  panelDate: string;
  rating: number;
  source: string;
  fleetCount: number;
  /** Optional — a draft created before this field existed may not carry one. */
  constitution?: string;
  kyc: KycItem[];
  documents: VendorDocument[];
  advanceHistory: AdvanceHistoryRow[];
  fleet: FleetRow[];
  business: {
    trips: number;
    revenuePaise: number;
    marginPaise: number;
    advanceOutstandingPaise: number;
    balancePendingPaise: number;
    penaltiesAccruedPaise: number;
    topLanes: { lane: string; trips: number; marginPct: number }[];
  };
}

export interface Lead {
  id: string;
  code: string;
  name: string;
  city: string;
  source: string;
  partyType: PartyType;
  trucksClaimed: number;
  phone: string;
  stage: 'NEW' | 'CONTACTED' | 'DOCUMENTS_REQUESTED' | 'QUALIFIED' | 'CONVERTED' | 'DROPPED';
  notes: string;
  /**
   * The transporter this lead became, once it has become one — all three are
   * null until then. They come back on the list itself, so a converted lead
   * can name what happened to it without a second fetch. Trust these over
   * reading `stage`: they are the link, not an inference from it.
   */
  convertedVendorId: string | null;
  convertedVendorCode: string | null;
  convertedVendorName: string | null;
}

export interface MarketGapRow {
  id: string;
  branchId: string;
  branchName: string;
  lane: string;
  truckType: string;
  target: number;
  onPanel: number;
  converted: number;
  gap: number;
  progressPct: number;
}

/** What `POST /vendors/issues` accepts — the server names the vendor from the id. */
export interface IssueDraft {
  vendorId: string;
  category: string;
  severity: Issue['severity'];
  tripCode?: string | null;
  note?: string;
}

export interface Issue {
  id: string;
  code: string;
  vendorId: string;
  vendorName: string;
  category: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  tripCode: string | null;
  raisedBy: string;
  raisedAt: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  note: string;
}

export interface ComplianceQueue {
  key: string;
  name: string;
  rows: {
    ref: string;
    subject: string;
    note: string;
    ageDays: number;
    /** Null when nothing is ageing enough to warrant a flag — the server omits it, not a placeholder string. */
    flag: string | null;
    tone: 'mint' | 'flag' | 'red' | 'blue' | 'grey';
    href: string;
    action: string;
  }[];
}

/** Draft body for the five-step onboarding wizard. */
export interface VendorDraft {
  legalName: string;
  baseCity: string;
  partyType: PartyType;
  gstin?: string;
  phone: string;
  altPhone?: string;
  branchId: string;
  pan?: string;
  truckTypes?: string[];
  operatingStates?: string[];
  fleetCount?: number;
  bankAccount?: string;
  ifsc?: string;
  accountHolder?: string;
  advancePct?: number;
  remarks?: string;
  bodyType?: string;
  /**
   * Sent on create only. The server converts that lead inside the same
   * transaction as the vendor insert — copying its source across and marking
   * it converted — so the two can never end up half-done.
   */
  leadId?: string;
}
