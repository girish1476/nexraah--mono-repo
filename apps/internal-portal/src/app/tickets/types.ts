/** Mirrors `apps/internal-api/src/modules/tickets/`. */

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'WONT_FIX';
export type TicketKind = 'WRONG_DATA' | 'MISSING_DATA' | 'ACCESS' | 'HOW_DO_I' | 'OTHER';
export type TicketSeverity = 'BLOCKING' | 'NORMAL' | 'MINOR';

/** The floor the server enforces, repeated so the form says so before you send. */
export const MIN_DETAIL = 20;
export const MIN_SUBJECT = 5;

export interface Ticket {
  id: string;
  code: string;
  subject: string;
  detail: string;
  kind: TicketKind;
  severity: TicketSeverity;
  status: TicketStatus;
  /** The console route the reporter was looking at. Captured, never typed. */
  raisedOnPath: string;
  entityType: string | null;
  entityId: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  resolvedByName: string | null;
  createdAt: string;
  raisedBy: string;
  raisedByName: string | null;
  branchName: string | null;
}

export interface TicketQueue {
  /** True when this person can act on anybody's report, not only read their own. */
  canResolve: boolean;
  scope: 'ALL' | 'MINE';
  summary: {
    open: number;
    inProgress: number;
    blocking: number;
    oldestOpenDays: number | null;
  };
  rows: Ticket[];
}

/* ---- plain words, never the enum ---------------------------------------- */

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: 'Waiting to be picked up',
  IN_PROGRESS: 'Being looked at',
  RESOLVED: 'Sorted',
  WONT_FIX: 'Closed without a change',
};

export const TICKET_STATUS_EMOJI: Record<TicketStatus, string> = {
  OPEN: '📥',
  IN_PROGRESS: '🔧',
  RESOLVED: '✅',
  WONT_FIX: '🚫',
};

export const TICKET_STATUS_TONE = {
  OPEN: 'flag',
  IN_PROGRESS: 'blue',
  RESOLVED: 'mint',
  WONT_FIX: 'grey',
} as const;

export const TICKET_KIND_LABEL: Record<TicketKind, string> = {
  WRONG_DATA: 'Something on screen is wrong',
  MISSING_DATA: 'Something is missing',
  ACCESS: 'I cannot get to something I need',
  HOW_DO_I: 'I do not know how to do this',
  OTHER: 'Something else',
};

export const TICKET_SEVERITY_LABEL: Record<TicketSeverity, string> = {
  BLOCKING: 'I cannot get on with my work',
  NORMAL: 'Worth fixing, not urgent',
  MINOR: 'Small thing',
};

export const TICKET_SEVERITY_TONE = {
  BLOCKING: 'red',
  NORMAL: 'flag',
  MINOR: 'grey',
} as const;
