import { istMinutes, minutesOf, saturdayOrdinal, weekday } from './calendar';
import { AttendanceDay, AttendanceRecord, DayStatus, Holiday, HrPolicy, LeaveRequest, MonthSummary } from './types';

/**
 * What a day was — the one place the rules live, so My HR, the HR board,
 * the monthly register and payroll can never disagree about a day.
 *
 * In order: HR's override wins; then approved leave; then a punch (worked
 * on a holiday is still worked); then the calendar (holiday, weekly off);
 * then "not yet" for today and "absent" for a working day gone by.
 */

/** Metres between two points on the earth. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.asin(Math.sqrt(h)));
}

export function isWeeklyOff(date: string, policy: Pick<HrPolicy, 'weeklyOffs' | 'alternateSaturdaysOff'>): boolean {
  const wd = weekday(date);
  if (policy.weeklyOffs.includes(wd)) return true;
  if (wd === 6 && policy.alternateSaturdaysOff) return [2, 4].includes(saturdayOrdinal(date));
  return false;
}

export function holidayOn(date: string, holidays: Holiday[], branchCode: string): Holiday | null {
  return holidays.find((h) => h.date === date && !h.optional && (!h.branches || h.branches.includes(branchCode))) ?? null;
}

/** The approved leave covering a date, if any. */
export function leaveOn(date: string, leaves: LeaveRequest[]): LeaveRequest | null {
  return leaves.find((l) => l.status === 'APPROVED' && l.from <= date && date <= l.to) ?? null;
}

export interface DayContext {
  date: string;
  today: string;
  now: string;
  joinedOn: string;
  exitOn: string | null;
  policy: HrPolicy;
  branchCode: string;
  holidays: Holiday[];
  /** This person's leave requests — only APPROVED ones count. */
  leaves: LeaveRequest[];
  correctionPending: boolean;
}

export function dayFor(record: AttendanceRecord | undefined, ctx: DayContext): AttendanceDay {
  const { date, today, policy } = ctx;
  const holiday = holidayOn(date, ctx.holidays, ctx.branchCode);
  const leave = leaveOn(date, ctx.leaves);
  const off = isWeeklyOff(date, policy);
  const base: AttendanceDay = {
    date,
    status: 'NONE',
    checkIn: record?.checkIn ?? null,
    checkOut: record?.checkOut ?? null,
    workedMinutes: 0,
    lateByMinutes: 0,
    inPlace: record?.inPlace ?? null,
    outPlace: record?.outPlace ?? null,
    holidayName: holiday?.name ?? null,
    leaveType: leave?.type ?? null,
    note: record?.note ?? null,
    correctionPending: ctx.correctionPending,
  };

  if (date < ctx.joinedOn || (ctx.exitOn && date > ctx.exitOn)) return base;

  // Worked time: to the check-out, or to now while today's shift is still open.
  if (record?.checkIn) {
    const end = record.checkOut ?? (date === today ? ctx.now : null);
    base.workedMinutes = end ? Math.max(0, Math.round((Date.parse(end) - Date.parse(record.checkIn)) / 60_000)) : 0;
    base.lateByMinutes = Math.max(0, istMinutes(record.checkIn) - minutesOf(policy.shiftStart));
  }

  if (record?.statusOverride) return { ...base, status: record.statusOverride };

  if (leave && !leave.halfDay) return { ...base, status: 'ON_LEAVE' };

  if (date > today) {
    const future: DayStatus = holiday ? 'HOLIDAY' : off ? 'WEEKLY_OFF' : leave ? 'ON_LEAVE' : 'NONE';
    return { ...base, status: future };
  }

  if (record?.checkIn) {
    const outside = record.inPlace ? !record.inPlace.withinBranch : false;
    // A half day's leave plus the half worked makes a full, paid day.
    if (leave?.halfDay) return { ...base, status: 'ON_LEAVE' };
    if (holiday || off) return { ...base, status: 'PRESENT', note: base.note ?? (holiday ? 'Worked on a holiday' : 'Worked on a weekly off') };
    const finished = !!record.checkOut;
    if (finished && base.workedMinutes < policy.halfDayMinutes) return { ...base, status: 'ABSENT', note: base.note ?? 'Less than a half day worked' };
    if (finished && base.workedMinutes < policy.fullDayMinutes) return { ...base, status: 'HALF_DAY' };
    if (outside) return { ...base, status: 'ON_DUTY' };
    if (base.lateByMinutes > policy.graceMinutes) return { ...base, status: 'LATE' };
    return { ...base, status: 'PRESENT' };
  }

  if (holiday) return { ...base, status: 'HOLIDAY' };
  if (off) return { ...base, status: 'WEEKLY_OFF' };
  if (leave?.halfDay) return { ...base, status: date === today ? 'NOT_YET' : 'HALF_DAY' };
  return { ...base, status: date === today ? 'NOT_YET' : 'ABSENT' };
}

/** Counts for a month, and the days that go unpaid. */
export function summarise(month: string, days: AttendanceDay[], leaves: LeaveRequest[], paidLeave: (type: string) => boolean): MonthSummary {
  const count = (s: DayStatus) => days.filter((d) => d.status === s).length;
  let lop = 0;
  for (const d of days) {
    if (d.status === 'ABSENT') lop += 1;
    else if (d.status === 'HALF_DAY') lop += 0.5;
    else if (d.status === 'ON_LEAVE') {
      const l = leaveOn(d.date, leaves);
      if (l && !paidLeave(l.type)) lop += l.halfDay ? 0.5 : 1;
    }
  }
  const worked = days.filter((d) => d.workedMinutes > 0 && d.checkOut);
  return {
    month,
    daysInMonth: days.length,
    workingDays: days.filter((d) => d.status !== 'HOLIDAY' && d.status !== 'WEEKLY_OFF').length,
    present: count('PRESENT') + count('LATE'),
    late: count('LATE'),
    halfDays: count('HALF_DAY'),
    absent: count('ABSENT'),
    onLeave: count('ON_LEAVE'),
    onDuty: count('ON_DUTY'),
    holidays: count('HOLIDAY'),
    weeklyOffs: count('WEEKLY_OFF'),
    lopDays: lop,
    avgWorkedMinutes: worked.length ? Math.round(worked.reduce((a, d) => a + d.workedMinutes, 0) / worked.length) : 0,
  };
}

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  PRESENT: 'Present',
  LATE: 'Late',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  ON_DUTY: 'On duty',
  HOLIDAY: 'Holiday',
  WEEKLY_OFF: 'Weekly off',
  NOT_YET: 'Not checked in',
  NONE: '',
};

/** One colour per status, shared by every calendar, pill and chart. */
export const DAY_STATUS_HUE: Record<DayStatus, string> = {
  PRESENT: 'var(--hr-present)',
  LATE: 'var(--hr-late)',
  HALF_DAY: 'var(--hr-half)',
  ABSENT: 'var(--hr-absent)',
  ON_LEAVE: 'var(--hr-leave)',
  ON_DUTY: 'var(--hr-duty)',
  HOLIDAY: 'var(--hr-holiday)',
  WEEKLY_OFF: 'var(--hr-off)',
  NOT_YET: 'var(--hr-notyet)',
  NONE: 'transparent',
};
