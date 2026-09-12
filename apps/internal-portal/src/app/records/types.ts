/** Mirrors `apps/internal-api/src/modules/audit/audit-read.service.ts`. */

export interface ChangedField {
  field: string;
  from: unknown;
  to: unknown;
}

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string;
  /** True when a transporter did it through their own portal, not one of our desks. */
  byVendor: boolean;
  action: string;
  actionLabel: string;
  entityType: string;
  entityLabel: string;
  entityId: string | null;
  /** A whole sentence, composed server-side so both apps say it the same way. */
  summary: string;
  changed: ChangedField[];
  before: unknown;
  after: unknown;
}

export interface AuditPage {
  total: number;
  limit: number;
  offset: number;
  events: AuditEvent[];
}

export interface AuditFilterOptions {
  actions: { code: string; label: string }[];
  entityTypes: { code: string; label: string }[];
}
