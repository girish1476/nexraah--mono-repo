import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/domain-exception';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { TicketsRepository } from './tickets.repository';
import { RaiseTicketDto, UpdateTicketDto } from './tickets.dto';
import {
  TICKET_KINDS,
  TICKET_SEVERITIES,
  TICKET_STATUSES,
  asOneOf,
  canRead,
  checkTransition,
  summarise,
  type TicketSeverity,
  type TicketStatus,
} from './ticket-rules';

/**
 * Tickets — reporting wrong data from the screen it is wrong on.
 *
 * The audit trail records every change and refuses to be edited, which is
 * exactly right for proving what happened and useless to somebody looking at a
 * client name spelt wrong in front of them. A ticket is the missing third
 * option between ringing somebody and leaving it.
 *
 * Two rules shape everything here:
 *
 *  1. **Anyone may raise one.** The person who notices wrong data is whoever
 *     happened to be on the screen, so there is no permission on `create`.
 *  2. **Only `ticket.resolve` reads the queue.** Reports name records the
 *     reader may not be able to open and quote what a colleague got wrong.
 *     Everybody else sees their own.
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly ticketsRepository: TicketsRepository,
    private readonly numberingService: NumberingService,
    private readonly auditService: AuditService,
  ) {}

  private canResolve(actor: AuthenticatedUser): boolean {
    return actor.permissions.has('ticket.resolve');
  }

  async list(
    filters: { status?: string; kind?: string; severity?: string; q?: string; mine?: boolean },
    actor: AuthenticatedUser,
  ) {
    const resolver = this.canResolve(actor);
    const rows = await this.ticketsRepository.list({
      // Narrowed rather than trusted: these arrive from a query string, and a
      // value that is not a status is dropped instead of matching nothing.
      status: asOneOf(TICKET_STATUSES, filters.status),
      kind: asOneOf(TICKET_KINDS, filters.kind),
      severity: asOneOf(TICKET_SEVERITIES, filters.severity),
      q: filters.q,
      /*
       * The scoping, applied here and nowhere the caller can reach. Somebody
       * without `ticket.resolve` gets their own reports whatever they ask for;
       * a resolver may narrow to their own with `mine`.
       */
      raisedBy: resolver ? (filters.mine ? actor.userId : undefined) : actor.userId,
    });

    const now = new Date();
    return {
      canResolve: resolver,
      /*
       * Stated so the screen can say "showing your reports" rather than
       * quietly showing a short list that looks like an empty queue.
       */
      scope: resolver && !filters.mine ? 'ALL' : 'MINE',
      summary: summarise(
        rows.map((r) => ({
          status: r.status as TicketStatus,
          severity: r.severity as TicketSeverity,
          createdAt: String(r.createdAt),
        })),
        now,
      ),
      rows: rows.map((r) => ({ ...r, createdAt: String(r.createdAt) })),
    };
  }

  async getById(id: string, actor: AuthenticatedUser) {
    const ticket = await this.ticketsRepository.findById(id);
    if (!ticket) throw new DomainException(404, 'NOT_FOUND', `Unknown ticket: ${id}`);
    if (!canRead({ raisedBy: ticket.raised_by }, { userId: actor.userId, canResolve: this.canResolve(actor) })) {
      /*
       * 404, not 403. Telling somebody a ticket exists that they may not read
       * is itself a disclosure — and there is nothing they can do with the
       * distinction.
       */
      throw new DomainException(404, 'NOT_FOUND', `Unknown ticket: ${id}`);
    }
    return ticket;
  }

  async raise(dto: RaiseTicketDto, actor: AuthenticatedUser) {
    return this.ticketsRepository.transaction().execute(async (trx) => {
      const code = await this.numberingService.issue(trx, 'TICKET');
      const ticket = await this.ticketsRepository.insert(trx, {
        code,
        subject: dto.subject.trim(),
        detail: dto.detail.trim(),
        kind: dto.kind ?? 'WRONG_DATA',
        severity: dto.severity ?? 'NORMAL',
        raised_on_path: dto.raisedOnPath,
        entity_type: dto.entityType ?? null,
        entity_id: dto.entityId ?? null,
        raised_by: actor.userId,
        branch_id: actor.branch?.id ?? null,
      });

      await this.auditService.record(trx, actor, {
        action: 'TICKET_RAISED',
        entityType: 'tickets',
        entityId: ticket.id,
        after: { code, subject: ticket.subject, raisedOnPath: ticket.raised_on_path },
      });

      return ticket;
    });
  }

  /**
   * Acting on a ticket — `ticket.resolve` only, gated at the controller.
   *
   * The transition rules live in `ticket-rules.ts` so the refusal is a
   * sentence rather than a constraint violation, and so the portal's fixture
   * can mirror them.
   */
  async update(id: string, dto: UpdateTicketDto, actor: AuthenticatedUser) {
    return this.ticketsRepository.transaction().execute(async (trx) => {
      const ticket = await this.ticketsRepository.findByIdForUpdate(trx, id);
      if (!ticket) throw new DomainException(404, 'NOT_FOUND', `Unknown ticket: ${id}`);

      const patch: Record<string, unknown> = {};

      if (dto.severity && dto.severity !== ticket.severity) {
        patch.severity = dto.severity;
      }

      if (dto.status && dto.status !== ticket.status) {
        const check = checkTransition(ticket.status as TicketStatus, dto.status, dto.resolution);
        if (!check.ok) {
          throw new DomainException(
            400,
            `TICKET_${check.refusal}`,
            check.reason ?? 'That change is not allowed.',
          );
        }
        patch.status = dto.status;

        const closing = dto.status === 'RESOLVED' || dto.status === 'WONT_FIX';
        if (closing) {
          patch.resolution = (dto.resolution ?? '').trim();
          patch.resolved_by = actor.userId;
          patch.resolved_at = new Date().toISOString();
        } else {
          /*
           * Reopening clears the closure, deliberately. Leaving "resolved by
           * S. Krishnan on the 3rd" on a ticket that is open again says
           * something untrue about a named person.
           */
          patch.resolution = null;
          patch.resolved_by = null;
          patch.resolved_at = null;
        }
      } else if (dto.resolution !== undefined && ticket.status !== 'OPEN') {
        // Amending the note on a ticket already picked up or closed, without
        // moving it.
        patch.resolution = dto.resolution.trim() || null;
      }

      if (Object.keys(patch).length === 0) return ticket;

      const updated = await this.ticketsRepository.update(trx, id, patch);

      await this.auditService.record(trx, actor, {
        action: 'TICKET_UPDATED',
        entityType: 'tickets',
        entityId: id,
        before: { status: ticket.status, severity: ticket.severity },
        after: { status: updated.status, severity: updated.severity, resolution: updated.resolution },
      });

      return updated;
    });
  }
}
