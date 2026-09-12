import { request } from '@/apis';
import { Ticket, TicketKind, TicketQueue, TicketSeverity, TicketStatus } from './types';

/**
 * GET /tickets — the queue, or your own reports.
 *
 * Which of the two you get is decided by the server, not by this call. Anyone
 * without `ticket.resolve` is scoped to what they raised, and the response
 * says which it gave you in `scope` so the screen can be honest about it.
 */
export function listTickets(
  params: { status?: TicketStatus; kind?: TicketKind; severity?: TicketSeverity; q?: string; mine?: boolean } = {},
) {
  return request<TicketQueue>({
    url: '/tickets',
    method: 'GET',
    params: { ...params, mine: params.mine ? '1' : undefined },
  });
}

/**
 * POST /tickets — report a problem.
 *
 * No permission. The person who notices wrong data is whoever happened to be
 * on the screen, so every desk can raise one from every dashboard.
 */
export function raiseTicket(body: {
  subject: string;
  detail: string;
  kind?: TicketKind;
  severity?: TicketSeverity;
  raisedOnPath: string;
  entityType?: string;
  entityId?: string;
}) {
  return request<Ticket>({ url: '/tickets', method: 'POST', data: body });
}

/** PATCH /tickets/:id — pick one up, close it with what was done, or reopen it. */
export function updateTicket(
  id: string,
  body: { status?: TicketStatus; severity?: TicketSeverity; resolution?: string },
) {
  return request<Ticket>({ url: `/tickets/${id}`, method: 'PATCH', data: body });
}
