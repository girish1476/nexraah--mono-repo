/**
 * Dates for HR, in India time.
 *
 * Attendance is about the day in the office's clock, not the browser's or the
 * server's: a 9:40 check-in is late in Visakhapatnam wherever the computer
 * that recorded it thinks it is. Everything here works on `YYYY-MM-DD`
 * strings and computes weekdays at UTC noon, so no time zone can move a day.
 */

const IST_OFFSET_MIN = 330;

/** The India date of a moment. */
export function istDate(iso: string | Date): string {
  const t = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  return new Date(t + IST_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}

/** Minutes past midnight, India time. */
export function istMinutes(iso: string): number {
  const d = new Date(Date.parse(iso) + IST_OFFSET_MIN * 60_000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** "09:42" in India time. */
export function istClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = istMinutes(iso);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** "9:42 am" — friendlier than the 24-hour clock for people reading their own day. */
export function istClock12(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = istMinutes(iso);
  const h = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, '0');
  return `${h % 12 === 0 ? 12 : h % 12}:${mm} ${h < 12 ? 'am' : 'pm'}`;
}

/** The moment a given India date and "HH:MM" refer to, as an ISO string. */
export function istMoment(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.parse(`${date}T00:00:00Z`) + (h * 60 + m - IST_OFFSET_MIN) * 60_000).toISOString();
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every date of a month, first to last. */
export function datesOfMonth(month: string): string[] {
  return Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

/** Every date from `from` to `to`, both included. */
export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function shiftMonth(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** "November 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** "Mon, 23 Nov". */
export function dayLabel(date: string, withYear = false): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** "23 Nov 2026". */
export function dateLabel(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Which Saturday of its month a date is (1st, 2nd …), for alternate-Saturday offices. */
export function saturdayOrdinal(date: string): number {
  return Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;
}

/** "7h 42m". */
export function hoursLabel(minutes: number): string {
  if (!minutes || minutes < 0) return '0h';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${String(m).padStart(2, '0')}m` : `${h}h`;
}

/** Whole years between two dates — for "3 years at Nexraah". */
export function yearsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}
