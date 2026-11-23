import { datesBetween, daysBetween } from './calendar';
import { holidayOn, isWeeklyOff } from './attendance';
import { Holiday, HrPolicy, LeaveBalance, LeaveRequest, LeaveType } from './types';

/**
 * Leave: how many days a request is, what is left, and whether a request
 * can be made at all. Weekly offs and holidays inside a request are not
 * leave — a Friday-to-Monday request is two days, not four.
 */

export function leaveDays(
  from: string,
  to: string,
  halfDay: 'FIRST' | 'SECOND' | null,
  policy: HrPolicy,
  holidays: Holiday[],
  branchCode: string,
): number {
  if (to < from) return 0;
  const working = datesBetween(from, to).filter((d) => !isWeeklyOff(d, policy) && !holidayOn(d, holidays, branchCode));
  if (halfDay && from === to) return working.length ? 0.5 : 0;
  return working.length;
}

/** The calendar year a date counts against. */
export const leaveYearOf = (date: string) => date.slice(0, 4);

export function balances(
  types: LeaveType[],
  requests: LeaveRequest[],
  year: string,
  carried: Record<string, number> = {},
  /** Completed years with the company at the start of the leave year — privilege leave grows with them. */
  serviceYears = 0,
): LeaveBalance[] {
  return types.map((t) => {
    const mine = requests.filter((r) => r.type === t.code && leaveYearOf(r.from) === year);
    const used = mine.filter((r) => r.status === 'APPROVED').reduce((a, r) => a + r.days, 0);
    const pending = mine.filter((r) => r.status === 'PENDING').reduce((a, r) => a + r.days, 0);
    const carriedIn = Math.min(carried[t.code] ?? 0, t.carryForwardMax);
    const years = Math.max(0, serviceYears);
    const perYear = t.increasePerYear ?? 0;
    const quota = t.annualQuota + perYear * years;
    return {
      code: t.code,
      name: t.name,
      emoji: t.emoji,
      hue: t.hue,
      paid: t.paid,
      quota,
      baseQuota: t.annualQuota,
      increasePerYear: perYear,
      serviceYears: years,
      carriedIn,
      used,
      pending,
      // Unpaid leave has no quota: 0 here, and every screen says "no limit" for it.
      available: t.paid ? Math.max(0, quota + carriedIn - used - pending) : 0,
    };
  });
}

export interface LeaveAsk {
  type: string;
  from: string;
  to: string;
  halfDay: 'FIRST' | 'SECOND' | null;
  reason: string;
}

/** Why a request cannot be made, in words for the person making it — or `null` when it can. */
export function leaveProblem(
  ask: LeaveAsk,
  ctx: { today: string; type: LeaveType | undefined; days: number; balance: LeaveBalance | undefined; existing: LeaveRequest[] },
): string | null {
  const { type } = ctx;
  if (!type) return 'Choose the kind of leave.';
  if (!ask.from || !ask.to) return 'Choose the dates.';
  if (ask.to < ask.from) return 'The last day is before the first.';
  if (ask.halfDay && ask.from !== ask.to) return 'A half day is one date — make the first and last day the same.';
  if (daysBetween(ask.from, ask.to) > 45) return 'That is more than 45 days. Speak to HR for a long leave.';
  if (ask.from < ctx.today && !type.allowBackdated) return `${type.name} is applied for ahead of time. For a day already gone, use sick or unpaid leave.`;
  if (ask.reason.trim().length < 3) return 'Say briefly why — a few words is enough.';
  if (ctx.days <= 0) return 'Those dates are all weekly offs or holidays — no leave is needed.';
  const clash = ctx.existing.find(
    (r) => (r.status === 'PENDING' || r.status === 'APPROVED') && r.from <= ask.to && ask.from <= r.to,
  );
  if (clash) return `You already have leave from ${clash.from} to ${clash.to}. Cancel that first, or pick other dates.`;
  if (type.paid && ctx.balance && ctx.days > ctx.balance.available)
    return `Only ${ctx.balance.available} day${ctx.balance.available === 1 ? '' : 's'} of ${type.name.toLowerCase()} left. Choose unpaid leave for the rest.`;
  return null;
}

export const LEAVE_STATUS_LABEL: Record<LeaveRequest['status'], string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  CANCELLED: 'Cancelled',
};
