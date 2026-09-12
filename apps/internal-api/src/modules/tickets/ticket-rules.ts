/**
 * What a ticket may do next — pure, dependency-free, testable without a
 * database and mirrorable by the portal's fixture.
 */

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_KINDS = ['WRONG_DATA', 'MISSING_DATA', 'ACCESS', 'HOW_DO_I', 'OTHER'] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

export const TICKET_SEVERITIES = ['BLOCKING', 'NORMAL', 'MINOR'] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

/** Matches the approvals engine's reason floor. A four-word report is a second conversation. */
export const MIN_DETAIL = 20;
export const MIN_SUBJECT = 5;
export const MAX_SUBJECT = 140;

/**
 * The two terminal states need a note saying what was done.
 *
 * A ticket closed silently tells the person who raised it nothing, so they
 * raise it again next week — and the queue fills with the same report three
 * times. The database enforces this too (`tickets_resolution_needs_note`);
 * it is here as well so the refusal arrives as a sentence rather than a
 * constraint violation.
 */
export function needsResolution(status: TicketStatus): boolean {
  return status === 'RESOLVED' || status === 'WONT_FIX';
}

export function isClosed(status: TicketStatus): boolean {
  return needsResolution(status);
}

export type TransitionRefusal =
  | 'ALREADY_CLOSED'
  | 'RESOLUTION_REQUIRED'
  | 'RESOLUTION_TOO_SHORT'
  | 'NOT_A_STATUS';

export interface TransitionCheck {
  ok: boolean;
  refusal: TransitionRefusal | null;
  reason: string | null;
}

/**
 * Whether a ticket can move from `from` to `to`.
 *
 * Deliberately permissive about direction — an administrator may reopen a
 * ticket they closed by mistake, and forbidding it would mean raising a second
 * ticket about the first. What it refuses is closing without saying what was
 * done, and touching a ticket that is already closed.
 */
export function checkTransition(
  from: TicketStatus,
  to: string,
  resolution: string | null | undefined,
): TransitionCheck {
  if (!(TICKET_STATUSES as readonly string[]).includes(to)) {
    return { ok: false, refusal: 'NOT_A_STATUS', reason: `${to} is not a ticket status.` };
  }

  const next = to as TicketStatus;

  if (isClosed(from) && isClosed(next)) {
    return {
      ok: false,
      refusal: 'ALREADY_CLOSED',
      reason: 'This ticket is already closed. Reopen it first if there is more to do.',
    };
  }

  if (needsResolution(next)) {
    const note = (resolution ?? '').trim();
    if (note.length === 0) {
      return {
        ok: false,
        refusal: 'RESOLUTION_REQUIRED',
        reason: 'Say what was done about it. The person who reported it reads this.',
      };
    }
    if (note.length < MIN_DETAIL) {
      return {
        ok: false,
        refusal: 'RESOLUTION_TOO_SHORT',
        reason: `Say what was done in at least ${MIN_DETAIL} characters — "fixed" is not an answer.`,
      };
    }
  }

  return { ok: true, refusal: null, reason: null };
}

/**
 * Who may see a ticket.
 *
 * Everyone can raise one, so everyone can read their own. Reading the whole
 * queue is what `ticket.resolve` buys — reports name records other desks
 * cannot open and quote what somebody got wrong, which is not general reading
 * material.
 */
export function canRead(
  ticket: { raisedBy: string },
  actor: { userId: string; canResolve: boolean },
): boolean {
  return actor.canResolve || ticket.raisedBy === actor.userId;
}

/** How long a ticket has been open, for the queue's ageing column. */
export function ageDays(createdAt: string, now: Date): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  return Math.max(0, Math.floor((now.getTime() - created) / 86_400_000));
}

export interface TicketQueueSummary {
  open: number;
  inProgress: number;
  blocking: number;
  /** The oldest thing still open, in days. Null when nothing is open. */
  oldestOpenDays: number | null;
}

/**
 * The queue header. Leads with what is blocking somebody's work rather than
 * with the total — a count of open tickets is a number, "two people cannot get
 * on with their job" is a queue.
 */
export function summarise(
  tickets: { status: TicketStatus; severity: TicketSeverity; createdAt: string }[],
  now: Date,
): TicketQueueSummary {
  const live = tickets.filter((t) => !isClosed(t.status));
  const ages = live.map((t) => ageDays(t.createdAt, now));
  return {
    open: tickets.filter((t) => t.status === 'OPEN').length,
    inProgress: tickets.filter((t) => t.status === 'IN_PROGRESS').length,
    blocking: live.filter((t) => t.severity === 'BLOCKING').length,
    oldestOpenDays: ages.length ? Math.max(...ages) : null,
  };
}

/**
 * Narrow a raw query-string value, or drop it.
 *
 * A filter arriving from a URL is genuinely unvalidated, and the honest answer
 * to `?status=RESOLVE` is to ignore it rather than to hand the database a value
 * it will match nothing against — an empty list reads as "nothing to do",
 * which is a different and much worse answer than "that is not a status".
 */
export function asOneOf<T extends string>(
  allowed: readonly T[],
  value: string | undefined,
): T | undefined {
  if (!value) return undefined;
  return (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}
