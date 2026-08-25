/**
 * The client onboarding gate — pure, dependency-free, one copy.
 *
 * Written this way for the reason the orders ladder was: a rule that decides
 * whether something may proceed will end up needing a mirror in the fixture
 * adapter, and two copies of a decision drift silently. A module with no
 * imports can be tested directly and compared against its mirror.
 *
 * The rule it encodes: Compliance clears a client before we carry for them,
 * the same way it clears a transporter before we give them loads.
 */

export const CLIENT_STATUSES = [
  'DRAFT',
  'PENDING_VERIFICATION',
  'ACTIVE',
  'REJECTED',
  'INACTIVE',
] as const;

export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_DOCUMENT_KINDS = [
  'GST_CERTIFICATE',
  'PAN',
  'SIGNED_AGREEMENT',
  'CREDIT_CHECK',
] as const;

export type ClientDocumentKind = (typeof CLIENT_DOCUMENT_KINDS)[number];

export type DocStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';

/** What a reader should see beside each paper. Plain words, not enum names. */
export const CLIENT_DOCUMENT_LABEL: Record<ClientDocumentKind, string> = {
  GST_CERTIFICATE: 'GST certificate',
  PAN: 'PAN card',
  SIGNED_AGREEMENT: 'Signed rate agreement',
  CREDIT_CHECK: 'Credit and credibility check',
};

/**
 * Which papers this particular client must produce.
 *
 * `SIGNED_AGREEMENT` applies only to CONTRACT clients: a spot client is priced
 * per load against a written confirmation on the indent itself (BR-26), so
 * demanding a rate contract from them would be asking for a document that does
 * not exist. Computed per client rather than kept as a constant precisely
 * because of that split.
 */
export function requiredDocumentKinds(engagement: string): ClientDocumentKind[] {
  const always: ClientDocumentKind[] = ['GST_CERTIFICATE', 'PAN', 'CREDIT_CHECK'];
  return engagement === 'CONTRACT' ? [...always, 'SIGNED_AGREEMENT'] : always;
}

export interface UnmetCondition {
  key: string;
  label: string;
  state: 'MISSING' | 'UNVERIFIED' | 'REJECTED';
}

export interface OnboardingGate {
  unmet: UnmetCondition[];
  cleared: { key: string; label: string }[];
  /** True when every required paper is VERIFIED. */
  canActivate: boolean;
}

/**
 * What is still standing between this client and being cleared.
 *
 * Returns the checklist rather than a yes/no, so the screen can show a person
 * exactly which paper is missing and in what way. Same contract as the advance
 * and balance gates, so `BlockedPanel` renders it with no new component.
 */
export function onboardingGate(
  engagement: string,
  byKind: Map<ClientDocumentKind, DocStatus>,
): OnboardingGate {
  const required = requiredDocumentKinds(engagement);
  const unmet: UnmetCondition[] = [];
  const cleared: { key: string; label: string }[] = [];

  for (const kind of required) {
    const label = CLIENT_DOCUMENT_LABEL[kind];
    const status = byKind.get(kind);

    if (!status) {
      unmet.push({ key: kind, label: `${label} not uploaded`, state: 'MISSING' });
      continue;
    }
    switch (status) {
      case 'VERIFIED':
        cleared.push({ key: kind, label });
        break;
      case 'REJECTED':
        unmet.push({ key: kind, label: `${label} rejected — a new one is needed`, state: 'REJECTED' });
        break;
      case 'PENDING':
        unmet.push({ key: kind, label: `${label} uploaded but not checked`, state: 'UNVERIFIED' });
        break;
      default:
        // Exhaustive: adding a document state without handling it here is a
        // build error rather than a paper that silently counts as cleared.
        return assertNever(status, 'onboardingGate: document status');
    }
  }

  return { unmet, cleared, canActivate: unmet.length === 0 };
}

/**
 * Whether indents may be raised against a client in this state.
 *
 * The gate that gives onboarding teeth. Without it the pipeline would be a
 * form somebody fills in, and work would carry on regardless — which is what
 * happened before: a client was created ACTIVE and nothing ever checked.
 */
export function canRaiseIndent(status: ClientStatus): boolean {
  return status === 'ACTIVE';
}

/** Why not, in words an operator can act on. */
export function indentBlockReason(status: ClientStatus): string | null {
  switch (status) {
    case 'ACTIVE':
      return null;
    case 'DRAFT':
      return 'This client has not been submitted for checks yet. Compliance has to clear them before we can carry for them.';
    case 'PENDING_VERIFICATION':
      return 'Compliance is still checking this client’s papers. The load can be raised once they are cleared.';
    case 'REJECTED':
      return 'Compliance declined this client, so no work can be booked against them.';
    case 'INACTIVE':
      return 'This client has been stood down. Reactivate them before booking new work.';
    default:
      return assertNever(status, 'indentBlockReason: client status');
  }
}

function assertNever(value: never, context: string): never {
  throw new Error(`${context}: unhandled value ${JSON.stringify(value)}`);
}
