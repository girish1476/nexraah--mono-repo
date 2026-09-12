import { describe, it, expect } from 'vitest';
import {
  MIN_DETAIL,
  ageDays,
  canRead,
  checkTransition,
  isClosed,
  summarise,
  type TicketSeverity,
  type TicketStatus,
} from './ticket-rules';

/**
 * Tickets — reporting wrong data from the screen it is wrong on.
 *
 * The audit trail records every change and refuses to be edited, which proves
 * what happened and does nothing for somebody looking at a client name spelt
 * wrong in front of them. Their options were to ring somebody or leave it.
 *
 * These pin the two rules the feature actually turns on: a ticket cannot be
 * closed without saying what was done, and a report is only readable by the
 * person who raised it or by whoever answers them.
 */

describe('closing a ticket', () => {
  it('refuses to close one without saying what was done', () => {
    /*
     * The rule the whole thing rests on. A ticket closed silently tells the
     * reporter nothing, so they raise it again next week and the queue fills
     * with the same report three times.
     */
    for (const to of ['RESOLVED', 'WONT_FIX']) {
      const check = checkTransition('OPEN', to, null);
      expect(check.ok, to).toBe(false);
      expect(check.refusal).toBe('RESOLUTION_REQUIRED');
    }
  });

  it('refuses a note too short to be an answer', () => {
    const check = checkTransition('OPEN', 'RESOLVED', 'fixed');
    expect(check.refusal).toBe('RESOLUTION_TOO_SHORT');
    expect(check.reason).toContain('"fixed" is not an answer');
  });

  it('accepts a real note at the floor', () => {
    expect(checkTransition('OPEN', 'RESOLVED', 'x'.repeat(MIN_DETAIL)).ok).toBe(true);
  });

  it('treats whitespace as no note at all', () => {
    // Otherwise twenty spaces closes a ticket.
    expect(checkTransition('OPEN', 'RESOLVED', '   '.repeat(10)).refusal).toBe('RESOLUTION_REQUIRED');
  });

  it('needs no note to pick one up', () => {
    // IN_PROGRESS is not a closure — asking for an explanation to start work
    // is how people stop marking what they are working on.
    expect(checkTransition('OPEN', 'IN_PROGRESS', null).ok).toBe(true);
  });
});

describe('moving a ticket that is already closed', () => {
  it('refuses to close a closed one twice', () => {
    const check = checkTransition('RESOLVED', 'WONT_FIX', 'A long enough explanation here.');
    expect(check.refusal).toBe('ALREADY_CLOSED');
  });

  it('allows reopening, deliberately', () => {
    /*
     * An administrator who closed the wrong ticket should reopen it, not raise
     * a second ticket about the first.
     */
    expect(checkTransition('RESOLVED', 'OPEN', null).ok).toBe(true);
    expect(checkTransition('WONT_FIX', 'IN_PROGRESS', null).ok).toBe(true);
  });

  it('refuses a status that does not exist', () => {
    expect(checkTransition('OPEN', 'CLOSED', 'note').refusal).toBe('NOT_A_STATUS');
  });

  it('agrees with itself about which statuses are closed', () => {
    expect(isClosed('RESOLVED')).toBe(true);
    expect(isClosed('WONT_FIX')).toBe(true);
    expect(isClosed('OPEN')).toBe(false);
    expect(isClosed('IN_PROGRESS')).toBe(false);
  });
});

describe('who can read a ticket', () => {
  const ticket = { raisedBy: 'u-ops' };

  it('lets the person who raised it read it', () => {
    expect(canRead(ticket, { userId: 'u-ops', canResolve: false })).toBe(true);
  });

  it('lets whoever answers tickets read anyone’s', () => {
    expect(canRead(ticket, { userId: 'u-adm', canResolve: true })).toBe(true);
  });

  it('does not show one desk another desk’s report', () => {
    /*
     * Reports name records the reader may not be able to open and quote what
     * a colleague got wrong. That is not general reading material.
     */
    expect(canRead(ticket, { userId: 'u-fin', canResolve: false })).toBe(false);
  });
});

describe('the queue header', () => {
  const now = new Date('2026-09-03T10:00:00Z');
  const t = (
    status: TicketStatus,
    severity: TicketSeverity,
    createdAt: string,
  ) => ({ status, severity, createdAt });

  it('leads with what is blocking somebody, not with the total', () => {
    const s = summarise(
      [
        t('OPEN', 'BLOCKING', '2026-09-01T10:00:00Z'),
        t('IN_PROGRESS', 'NORMAL', '2026-08-30T10:00:00Z'),
        t('RESOLVED', 'BLOCKING', '2026-08-01T10:00:00Z'),
      ],
      now,
    );
    expect(s.blocking).toBe(1); // the resolved one is not blocking anybody
    expect(s.open).toBe(1);
    expect(s.inProgress).toBe(1);
  });

  it('ages from the oldest thing still open', () => {
    const s = summarise(
      [
        t('OPEN', 'NORMAL', '2026-08-25T10:00:00Z'),
        t('RESOLVED', 'NORMAL', '2020-01-01T00:00:00Z'),
      ],
      now,
    );
    // The nine-day-old open one, not the closed one from six years ago.
    expect(s.oldestOpenDays).toBe(9);
  });

  it('says nothing rather than zero when the queue is empty', () => {
    const s = summarise([t('RESOLVED', 'NORMAL', '2026-09-01T10:00:00Z')], now);
    expect(s.oldestOpenDays).toBeNull();
  });

  it('never reports a negative age from a clock skew', () => {
    expect(ageDays('2026-09-05T10:00:00Z', now)).toBe(0);
  });

  it('survives a date it cannot parse', () => {
    expect(ageDays('not a date', now)).toBe(0);
  });
});
