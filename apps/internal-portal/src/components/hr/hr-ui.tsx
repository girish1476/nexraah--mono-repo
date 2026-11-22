'use client';

import './hr.css';

import { ReactNode, useEffect, useState } from 'react';
import { DAY_STATUS_HUE, DAY_STATUS_LABEL } from '@/lib/hr/attendance';
import { dayLabel, hoursLabel, istClock12, weekday } from '@/lib/hr/calendar';
import type { AttendanceDay, DayStatus, Holiday, LeaveBalance } from '@/lib/hr/types';
import { Glyph } from '@/lib/ui';

/* ---- avatar ------------------------------------------------------------- */

const HUES = ['#2f57c7', '#0d7a6f', '#7141c9', '#b5541c', '#c0365f', '#12627e', '#a2600d', '#4a6b1f'];

export function initials(name: string): string {
  const parts = name.replace(/[^A-Za-z .]/g, '').split(/[\s.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·';
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: HUES[h % HUES.length] }}
    >
      {initials(name)}
    </span>
  );
}

export function Person({ name, sub, size = 36, right }: { name: string; sub?: ReactNode; size?: number; right?: ReactNode }) {
  return (
    <div className="person">
      <Avatar name={name} size={size} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="person-name">{name}</div>
        {sub && <div className="person-sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/* ---- ring --------------------------------------------------------------- */

export function Ring({
  value,
  max,
  size = 64,
  stroke = 7,
  color = 'var(--area-self)',
  track = 'var(--color-surface-sunken)',
  children,
}: {
  value: number;
  max: number;
  size?: number;
  stroke?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <span className="bal-ring" style={{ width: size, height: size, display: 'inline-block' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * p} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray 600ms ease' }}
        />
      </svg>
      {children !== undefined && <span className="bal-ring-val">{children}</span>}
    </span>
  );
}

/* ---- status ------------------------------------------------------------- */

export function DayPill({ status, children }: { status: DayStatus; children?: ReactNode }) {
  if (status === 'NONE') return <span className="hr-muted">—</span>;
  return (
    <span className="day-pill" style={{ ['--pill' as string]: DAY_STATUS_HUE[status] }}>
      {children ?? DAY_STATUS_LABEL[status]}
    </span>
  );
}

/* ---- live clock --------------------------------------------------------- */

/** The time in India, ticking. Rendered only in the browser so the server and client never disagree. */
export function useNow(everyMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

export function LiveClock() {
  const now = useNow();
  if (!now) return <div className="punch-clock">&nbsp;</div>;
  const t = now.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  const [clock, ampm] = t.split(' ');
  return (
    <div>
      <div className="punch-clock" aria-live="off">
        {clock}
        <small>{(ampm ?? '').toUpperCase()}</small>
      </div>
      <div className="punch-date">
        {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })}
      </div>
    </div>
  );
}

/* ---- month calendar ----------------------------------------------------- */

const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthCalendar({
  days,
  today,
  onPick,
}: {
  days: AttendanceDay[];
  today: string;
  onPick?: (d: AttendanceDay) => void;
}) {
  const lead = days.length ? weekday(days[0].date) : 0;
  return (
    <div className="cal" role="grid" aria-label="Attendance this month">
      {WEEK.map((w) => (
        <div key={w} className="cal-head" role="columnheader">
          {w}
        </div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div key={`b${i}`} className="cal-day is-blank" aria-hidden="true" />
      ))}
      {days.map((d) => {
        const n = Number(d.date.slice(8));
        const hue = DAY_STATUS_HUE[d.status];
        const label = d.holidayName ?? (d.status === 'NONE' ? '' : DAY_STATUS_LABEL[d.status]);
        const pickable = !!onPick && d.date <= today && d.status !== 'NONE';
        const content = (
          <>
            <span className="cal-num">{n}</span>
            {label && <span className="cal-tag">{label}</span>}
            {d.checkIn && (
              <span className="cal-time">
                {istClock12(d.checkIn)}
                {d.checkOut ? ` – ${istClock12(d.checkOut)}` : ''}
              </span>
            )}
            {d.correctionPending && (
              <span className="cal-flag" title="Correction waiting for approval">
                ⏳
              </span>
            )}
          </>
        );
        const cls = `cal-day${d.date === today ? ' is-today' : ''}`;
        const style = { ['--day' as string]: hue };
        const aria = `${dayLabel(d.date)}: ${label || 'no record'}${d.checkIn ? `, in ${istClock12(d.checkIn)}` : ''}${d.checkOut ? `, out ${istClock12(d.checkOut)}` : ''}`;
        return pickable ? (
          <button key={d.date} type="button" className={cls} style={style} onClick={() => onPick!(d)} aria-label={aria}>
            {content}
          </button>
        ) : (
          <div key={d.date} className={cls} style={style} aria-label={aria} role="gridcell">
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function Legend({ statuses }: { statuses: DayStatus[] }) {
  return (
    <div className="pay-legend">
      {statuses.map((s) => (
        <span key={s}>
          <i style={{ background: DAY_STATUS_HUE[s] }} />
          {DAY_STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

/* ---- week strip --------------------------------------------------------- */

export function WeekStrip({ days, today, fullDayMinutes }: { days: AttendanceDay[]; today: string; fullDayMinutes: number }) {
  return (
    <div className="week" aria-label="Your last seven days">
      {days.map((d) => {
        const off = d.status === 'WEEKLY_OFF' || d.status === 'HOLIDAY';
        const pct = d.workedMinutes ? Math.min(100, Math.round((d.workedMinutes / fullDayMinutes) * 100)) : off || d.status === 'ON_LEAVE' ? 100 : 6;
        return (
          <div key={d.date} className={`week-day${d.date === today ? ' is-today' : ''}`} title={`${dayLabel(d.date)} · ${DAY_STATUS_LABEL[d.status] || '—'}${d.workedMinutes ? ` · ${hoursLabel(d.workedMinutes)}` : ''}`}>
            <div className="week-bar">
              <span style={{ height: `${pct}%`, ['--day' as string]: off ? 'var(--hr-off)' : DAY_STATUS_HUE[d.status], opacity: off ? 0.5 : 1 }} />
            </div>
            <span>{dayLabel(d.date).split(',')[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ---- leave balance ------------------------------------------------------ */

export function Balance({ b, size = 58 }: { b: LeaveBalance; size?: number }) {
  const total = b.quota + b.carriedIn;
  return (
    <div className="bal">
      <Ring value={b.paid ? b.available : 1} max={b.paid ? Math.max(total, 1) : 1} size={size} stroke={6} color={b.hue}>
        {b.paid ? fmtDays(b.available) : '∞'}
      </Ring>
      <div style={{ minWidth: 0 }}>
        <div className="bal-name">
          <Glyph size={14}>{b.emoji}</Glyph>
          {b.name}
        </div>
        <div className="hr-muted">
          {b.paid ? (
            <>
              {fmtDays(b.available)} of {fmtDays(total)} left
              {b.pending ? ` · ${fmtDays(b.pending)} waiting` : ''}
            </>
          ) : (
            <>No limit · {fmtDays(b.used)} taken this year</>
          )}
        </div>
      </div>
    </div>
  );
}

export const fmtDays = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ''));
export const daysWord = (n: number) => `${fmtDays(n)} day${n === 1 ? '' : 's'}`;

/* ---- holidays ----------------------------------------------------------- */

export function HolidayRow({ h }: { h: Holiday }) {
  const d = new Date(`${h.date}T12:00:00Z`);
  return (
    <div className="hol">
      <div className="hol-date" aria-hidden="true">
        <div className="hol-date-m">{d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' })}</div>
        <div className="hol-date-d">{d.getUTCDate()}</div>
      </div>
      <div>
        <div style={{ fontWeight: 650 }}>{h.name}</div>
        <div className="hr-muted">
          {d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}
          {h.optional ? ' · optional' : ''}
        </div>
      </div>
    </div>
  );
}

/* ---- small pieces ------------------------------------------------------- */

export function Card({ title, emoji, right, children, style }: { title?: ReactNode; emoji?: string; right?: ReactNode; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section className="hr-card" style={style}>
      {(title || right) && (
        <div className="hr-card-head">
          {title && (
            <h2 className="hr-card-title">
              {emoji && <Glyph size={18}>{emoji}</Glyph>}
              {title}
            </h2>
          )}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ emoji, children }: { emoji: string; children: ReactNode }) {
  return (
    <div className="hr-empty">
      <Glyph size={28}>{emoji}</Glyph>
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode }[] }) {
  return (
    <div className="hr-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" className="hr-tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** "₹48,250" from paise, whole rupees. */
export function rupees(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
}

/** Saves text as a file the browser downloads. */
export function download(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([`﻿${text}`], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Label-and-value pairs, in the reading font (the console's FactList is for codes and numbers). */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="hr-facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A payroll month's state, in words. */
export const RUN_WORD = { DRAFT: 'draft', SUBMITTED: 'waiting for approval', APPROVED: 'approved, not released', RELEASED: 'paid and released' } as const;
