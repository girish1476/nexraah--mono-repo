import type { NotificationEvent } from './notification-events';

/**
 * Which POD reminder is due for a delivered trip, today — pure.
 *
 * Part 11 §4, against the deadlines in the control panel (here with the
 * defaults, 20 days to send the POD and 40 to forfeit the balance):
 *
 *   pod.due              5 days before the deadline        (day 15)
 *   pod.breached         the day after it, then weekly     (days 21, 28, 35)
 *   pod.forfeit_warning  5 days before the balance goes    (day 35)
 *
 * Each reminder carries its own key, and a reminder stays due from its day
 * until the next one starts — so a sweep that did not run for a day still
 * sends it the next, and one that runs twice sends it once.
 */

export interface PodClock {
  tatDays: number;
  forfeitDays: number;
}

export interface Reminder {
  event: NotificationEvent;
  key: string;
  dueOn: string;
  forfeitOn: string;
  daysLate: number;
}

const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Whole days between two instants, by the date in India. */
const daysBetween = (from: Date, to: Date) => {
  const local = (d: Date) => Date.parse(d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  return Math.floor((local(to) - local(from)) / DAY);
};

export function podRemindersDue(trip: { id: string; deliveredAt: string | Date }, today: Date, clock: PodClock): Reminder[] {
  const delivered = new Date(trip.deliveredAt);
  const days = daysBetween(delivered, today);
  const deliveredDay = Date.parse(delivered.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }));
  const dueOn = isoDay(deliveredDay + clock.tatDays * DAY);
  const forfeitOn = isoDay(deliveredDay + clock.forfeitDays * DAY);
  const base = { dueOn, forfeitOn, daysLate: Math.max(0, days - clock.tatDays) };
  const out: Reminder[] = [];

  if (days >= clock.forfeitDays) return out; // forfeited — the ageing job says so; nothing left to remind about

  if (days >= clock.tatDays - 5 && days < clock.tatDays) {
    out.push({ event: 'pod.due', key: `pod.due:${trip.id}`, ...base });
  }
  if (days > clock.tatDays) {
    const week = Math.floor((days - clock.tatDays - 1) / 7);
    out.push({ event: 'pod.breached', key: `pod.breached:${trip.id}:${week}`, ...base });
  }
  if (days >= clock.forfeitDays - 5) {
    out.push({ event: 'pod.forfeit_warning', key: `pod.forfeit_warning:${trip.id}`, ...base });
  }
  return out;
}
