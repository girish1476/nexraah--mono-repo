/**
 * Turning an audit row into a sentence a person can read.
 *
 * Pure and dependency-free, so it can be tested without a database and
 * mirrored by the portal's fixture.
 *
 * The trail stores `action: 'STATUS_CHANGE'`, `entity_type: 'trip_documents'`
 * — the vocabulary of the schema. Showing that to whoever is checking whether
 * a payment was legitimate is showing them the plumbing. Every row gets a
 * plain sentence instead, and an unknown action degrades to something readable
 * rather than to a blank.
 */

/** Verb per action code. Anything unlisted falls back to a de-slugged form. */
const ACTION_VERB: Record<string, string> = {
  CREATE: 'created',
  UPDATE: 'changed',
  DELETE: 'removed',
  STATUS_CHANGE: 'changed the status of',
  APPROVAL_RAISED: 'asked for approval on',
  APPROVAL_APPROVED: 'approved',
  APPROVAL_REJECTED: 'turned down',
  PAYMENT_RELEASED: 'released payment for',
  DOCUMENT_VERIFIED: 'verified a document on',
  DOCUMENT_REJECTED: 'rejected a document on',
  RATE_REVISION_APPLIED: 'changed the agreed rate on',
  VENDOR_ACTIVATED: 'cleared for work',
  CLIENT_ACTIVATED: 'cleared for work',
};

/** What the thing is, in the words the rest of the console uses for it. */
const ENTITY_NOUN: Record<string, string> = {
  vendors: 'transporter',
  vendor_documents: 'transporter’s papers',
  clients: 'client',
  client_documents: 'client’s papers',
  indents: 'load request',
  trips: 'trip',
  trip_documents: 'trip papers',
  rate_card_lanes: 'agreed rate',
  payments: 'payment',
  invoices: 'invoice',
  receipts: 'receipt',
  approvals: 'approval',
  pod_receipts: 'delivery proof',
  quotes: 'quote',
  rfqs: 'rate request',
  users: 'person',
  roles: 'role',
  config: 'setting',
  notifications: 'notification',
};

/** `STATUS_CHANGE` → `status change`; the honest fallback for a new action. */
function deslug(code: string): string {
  return code.toLowerCase().replace(/_/g, ' ');
}

export function actionLabel(action: string): string {
  return ACTION_VERB[action] ?? deslug(action);
}

export function entityLabel(entityType: string): string {
  return ENTITY_NOUN[entityType] ?? deslug(entityType);
}

/**
 * Which fields actually moved, so a reviewer sees the change rather than two
 * blobs of JSON to compare by eye.
 *
 * Only keys present in `after` are considered: a partial update writes only
 * what it touched, and treating every absent key as "removed" would report a
 * dozen phantom changes on every row.
 */
export function changedFields(
  before: unknown,
  after: unknown,
): { field: string; from: unknown; to: unknown }[] {
  if (!after || typeof after !== 'object' || Array.isArray(after)) return [];
  const b = (before && typeof before === 'object' && !Array.isArray(before) ? before : {}) as Record<
    string,
    unknown
  >;
  const a = after as Record<string, unknown>;

  return Object.keys(a)
    .filter((key) => JSON.stringify(b[key]) !== JSON.stringify(a[key]))
    .map((key) => ({ field: key, from: b[key] ?? null, to: a[key] }));
}

export interface AuditRowLike {
  actorName: string | null;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string | null;
}

/**
 * "Priya Nair (Finance) released payment for a payment."
 *
 * Deliberately does not include the id — it reads as noise in a sentence, and
 * the row shows it separately where it can be clicked.
 */
export function describe(row: AuditRowLike): string {
  const who = row.actorName ?? `Somebody with the ${row.actorRole} role`;
  return `${who} ${actionLabel(row.action)} a ${entityLabel(row.entityType)}`;
}
