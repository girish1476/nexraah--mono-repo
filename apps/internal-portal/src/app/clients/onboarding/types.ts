import { UnmetCondition } from '@/apis';

/**
 * Client onboarding — Compliance's queue.
 *
 * A client used to be created straight to ACTIVE and was usable immediately:
 * no papers, no credibility check, nobody's sign-off. These types describe the
 * pipeline that replaced that, deliberately shaped like the transporter one so
 * there is a single idea to learn rather than two.
 */

export type ClientOnboardingStatus =
  | 'DRAFT'
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'REJECTED'
  | 'INACTIVE';

/** Plain words, matching the vocabulary the rest of the console uses. */
export const CLIENT_STATUS_LABEL: Record<ClientOnboardingStatus, string> = {
  DRAFT: 'Being set up',
  PENDING_VERIFICATION: 'Papers being checked',
  ACTIVE: 'Cleared — we can carry for them',
  REJECTED: 'Declined',
  INACTIVE: 'Stood down',
};

export const CLIENT_STATUS_TONE: Record<ClientOnboardingStatus, 'mint' | 'flag' | 'red' | 'blue' | 'grey'> = {
  DRAFT: 'grey',
  PENDING_VERIFICATION: 'flag',
  ACTIVE: 'mint',
  REJECTED: 'red',
  INACTIVE: 'grey',
};

export const CLIENT_STATUS_EMOJI: Record<ClientOnboardingStatus, string> = {
  DRAFT: '📝',
  PENDING_VERIFICATION: '🔍',
  ACTIVE: '✅',
  REJECTED: '⛔',
  INACTIVE: '⏸️',
};

export type ClientDocumentKind = 'GST_CERTIFICATE' | 'PAN' | 'SIGNED_AGREEMENT' | 'CREDIT_CHECK';

/** `MISSING` is not a stored state — it is the absence of a row, named. */
export type ClientDocumentStatus = 'MISSING' | 'PENDING' | 'VERIFIED' | 'REJECTED';

export interface ClientOnboardingDocument {
  kind: ClientDocumentKind;
  /** Server-supplied, so the screen never keeps its own copy of the labels. */
  label: string;
  status: ClientDocumentStatus;
  reference: string | null;
  attachmentId: string | null;
  validFrom: string | null;
  validTo: string | null;
  rejectReason: string | null;
  verifiedAt: string | null;
  verifiedByName: string | null;
}

export interface ClientOnboardingRow {
  id: string;
  code: string;
  name: string;
  billingCity: string;
  engagement: 'SPOT' | 'CONTRACT';
  status: ClientOnboardingStatus;
  createdAt: string | null;
  /** How many papers this client owes, and how many are cleared. */
  required: number;
  cleared: number;
  unmetCount: number;
  canActivate: boolean;
}

export interface ClientOnboardingDetail {
  id: string;
  code: string;
  name: string;
  billingCity: string;
  gstin: string | null;
  engagement: 'SPOT' | 'CONTRACT';
  status: ClientOnboardingStatus;
  rejectionReason: string | null;
  documents: ClientOnboardingDocument[];
  /**
   * The checklist, computed on the server. Same contract as the advance and
   * balance gates, so `BlockedPanel` renders it with no new component — and,
   * more importantly, so the rule about which papers are required lives in
   * exactly one place rather than being re-derived here.
   */
  gate: {
    unmet: UnmetCondition[];
    cleared: { key: string; label: string }[];
    canActivate: boolean;
  };
}
