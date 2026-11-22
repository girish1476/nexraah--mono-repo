'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { DAY_STATUS_HUE, DAY_STATUS_LABEL, isWeeklyOff } from '@/lib/hr/attendance';
import { DEFAULT_POLICY } from '@/lib/hr/policy';
import { addDays, dayLabel, hoursLabel, istClock12, istDate, monthLabel, monthOf, shiftMonth, weekday } from '@/lib/hr/calendar';
import { BoardRow, RegisterRow, getApprovals, getBoard, getRegister } from '@/lib/hr/apis';
import type { DayStatus, PendingItem } from '@/lib/hr/types';
import { Column, DataTable, ErrorState, Loading, ModuleGuard, PageHeader, Stack, StatStrip, Toolbar } from '@/lib/ui';
import { Card, DayPill, Legend, Person, Tabs, download, fmtDays } from '@/components/hr/hr-ui';
import { PendingList } from '@/components/hr/pending-list';

type Tab = 'board' | 'register' | 'corrections';

/** Attendance — `/hr/attendance`. Today's board, the month's register, and corrections waiting. */
export default function HrAttendancePage() {
  const [tab, setTab] = useState<Tab>('board');
  const [pending, setPending] = useState<PendingItem[]>([]);
  const loadPending = useCallback(() => {
    getApprovals()
      .then((r) => setPending(r.pending.filter((p) => p.kind === 'CORRECTION')))
      .catch(() => undefined);
  }, []);
  useEffect(loadPending, [loadPending]);

  return (
    <ModuleGuard module="hr">
      <PageHeader title="Attendance" sub="Who is in, the month at a glance, and corrections people have asked for." module="hr" />
      <Stack gap={14}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'board', label: 'Today’s board' },
            { id: 'register', label: 'Monthly register' },
            { id: 'corrections', label: `Corrections${pending.length ? ` (${pending.length})` : ''}` },
          ]}
        />
        {tab === 'board' && <Board />}
        {tab === 'register' && <Register />}
        {tab === 'corrections' && (
          <Card title="Corrections waiting" emoji="🛠️">
            <PendingList items={pending} onDone={loadPending} empty="No corrections waiting." />
          </Card>
        )}
      </Stack>
    </ModuleGuard>
  );
}

/** Today, or the last working day before it when today is a weekly off — an empty board helps nobody. */
function lastWorkingDay(): string {
  let d = istDate(new Date());
  for (let i = 0; i < 7 && isWeeklyOff(d, DEFAULT_POLICY); i++) d = addDays(d, -1);
  return d;
}

function Board() {
  const [date, setDate] = useState(lastWorkingDay);
  const [branch, setBranch] = useState('');
  const [data, setData] = useState<{ rows: BoardRow[]; branches: { code: string; name: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [only, setOnly] = useState<'' | 'IN' | 'OUT' | 'LATE' | 'AWAY'>('');

  const load = useCallback(() => {
    setError(null);
    getBoard(date, branch).then(setData).catch((e) => setError(errorMessage(e)));
  }, [date, branch]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Reading the day" />;

  const count = (s: DayStatus[]) => data.rows.filter((r) => s.includes(r.day.status)).length;
  const filter: Record<string, DayStatus[]> = {
    IN: ['PRESENT', 'LATE', 'HALF_DAY', 'ON_DUTY'],
    OUT: ['NOT_YET', 'ABSENT'],
    LATE: ['LATE'],
    AWAY: ['ON_DUTY'],
  };
  const rows = only ? data.rows.filter((r) => filter[only].includes(r.day.status)) : data.rows;

  const columns: Column<BoardRow>[] = [
    { key: 'p', label: 'Person', render: (r) => <Link href={`/hr/employees/${r.id}`} style={{ color: 'inherit', textDecoration: 'none' }}><Person name={r.name} sub={`${r.designation} · ${r.branchName}`} size={32} /></Link> },
    { key: 's', label: 'Status', render: (r) => <DayPill status={r.day.status}>{r.day.holidayName ?? undefined}</DayPill> },
    { key: 'in', label: 'In', render: (r) => (r.day.checkIn ? `${istClock12(r.day.checkIn)}${r.day.lateByMinutes > 15 ? ` · ${r.day.lateByMinutes}m late` : ''}` : '—') },
    { key: 'out', label: 'Out', render: (r) => istClock12(r.day.checkOut) },
    { key: 'w', label: 'Worked', align: 'right', render: (r) => (r.day.workedMinutes ? hoursLabel(r.day.workedMinutes) : '—') },
    {
      key: 'where',
      label: 'Where',
      render: (r) =>
        r.day.inPlace ? (
          r.day.inPlace.withinBranch ? (
            <span className="hr-muted">📍 Office{r.day.inPlace.distanceM !== null ? ` · ${r.day.inPlace.distanceM} m` : ''}</span>
          ) : (
            <span title={r.day.inPlace.note ?? ''}>🧭 {r.day.inPlace.note ?? 'Away'}</span>
          )
        ) : r.day.note ? (
          <span className="hr-muted">{r.day.note}</span>
        ) : (
          ''
        ),
    },
    { key: 'call', label: '', render: (r) => (['NOT_YET', 'ABSENT'].includes(r.day.status) ? <a className="btn btn-secondary btn-sm" href={`tel:+91${r.phone}`}>📞</a> : null) },
  ];

  return (
    <Stack gap={12}>
      {date !== istDate(new Date()) && (
        <div className="hr-muted">
          Showing {dayLabel(date, true)}{isWeeklyOff(istDate(new Date()), DEFAULT_POLICY) && date === lastWorkingDay() ? ' — today is a weekly off' : ''}.{' '}
          <button className="btn btn-secondary btn-sm" onClick={() => setDate(istDate(new Date()))}>
            Show today
          </button>
        </div>
      )}
      <Toolbar>
        <input type="date" value={date} max={istDate(new Date())} onChange={(e) => setDate(e.target.value)} aria-label="Day" />
        <select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="Branch">
          <option value="">Every branch</option>
          {data.branches.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </Toolbar>
      <StatStrip
        compact
        stats={[
          { k: 'In', emoji: '✅', v: count(filter.IN), onClick: () => setOnly(only === 'IN' ? '' : 'IN'), active: only === 'IN' },
          { k: 'Not in', emoji: '⏳', v: count(filter.OUT), tone: count(filter.OUT) ? 'red' : undefined, onClick: () => setOnly(only === 'OUT' ? '' : 'OUT'), active: only === 'OUT' },
          { k: 'Late', emoji: '⏰', v: count(filter.LATE), tone: count(filter.LATE) ? 'flag' : undefined, onClick: () => setOnly(only === 'LATE' ? '' : 'LATE'), active: only === 'LATE' },
          { k: 'On duty away', emoji: '🧭', v: count(filter.AWAY), onClick: () => setOnly(only === 'AWAY' ? '' : 'AWAY'), active: only === 'AWAY' },
          { k: 'On leave', emoji: '🌴', v: count(['ON_LEAVE']) },
        ]}
      />
      <div className="surface">
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} empty={`Nobody ${only ? 'in that group' : 'on the rolls'} for ${dayLabel(date)}.`} />
      </div>
    </Stack>
  );
}

const SHORT: Partial<Record<DayStatus, string>> = { PRESENT: 'P', LATE: 'L', HALF_DAY: '½', ABSENT: 'A', ON_LEAVE: 'LV', ON_DUTY: 'OD', HOLIDAY: 'H', WEEKLY_OFF: '', NOT_YET: '·' };

function Register() {
  const [month, setMonth] = useState(monthOf(istDate(new Date())));
  const [data, setData] = useState<{ month: string; dates: string[]; rows: RegisterRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getRegister(month, '').then(setData).catch((e) => setError(errorMessage(e)));
  }, [month]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;

  const exportCsv = () => {
    if (!data) return;
    const head = ['Code', 'Name', ...data.dates.map((d) => d.slice(8)), 'Present', 'Late', 'Leave', 'Absent', 'Unpaid days'];
    const lines = [head.join(',')];
    for (const r of data.rows) {
      lines.push(
        [r.code, `"${r.name}"`, ...r.days.map((d) => SHORT[d.status] ?? ''), r.summary.present + r.summary.onDuty, r.summary.late, r.summary.onLeave, r.summary.absent, r.summary.lopDays].join(','),
      );
    }
    download(`attendance-${month}.csv`, lines.join('\r\n'));
  };

  return (
    <Card
      title={monthLabel(month)}
      emoji="📋"
      right={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
            ‹
          </button>
          <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= monthOf(istDate(new Date()))} aria-label="Next month">
            ›
          </button>
          <button className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!data}>
            ⬇️ Excel (CSV)
          </button>
        </div>
      }
    >
      <Legend statuses={['PRESENT', 'LATE', 'ON_DUTY', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY', 'WEEKLY_OFF']} />
      {!data || data.month !== month ? (
        <Loading what="Building the register" />
      ) : (
        <div className="register">
          <table>
            <thead>
              <tr>
                <th className="reg-name">Person</th>
                {data.dates.map((d) => (
                  <th key={d} className={`reg-head${[0].includes(weekday(d)) ? ' is-off' : ''}`} title={dayLabel(d)}>
                    {Number(d.slice(8))}
                    <br />
                    {'SMTWTFS'[weekday(d)]}
                  </th>
                ))}
                <th className="reg-head" style={{ paddingLeft: 8 }}>Paid off</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="reg-name">
                    <Link href={`/hr/employees/${r.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                      {r.name}
                    </Link>
                  </td>
                  {r.days.map((d) => (
                    <td key={d.date}>
                      <span
                        className={`reg-cell${d.status === 'WEEKLY_OFF' || d.status === 'NONE' || d.status === 'NOT_YET' ? ' is-light' : ''}`}
                        style={{ ['--day' as string]: d.status === 'NONE' ? 'transparent' : DAY_STATUS_HUE[d.status], opacity: d.status === 'WEEKLY_OFF' ? 0.45 : 1 }}
                        title={`${dayLabel(d.date)} · ${DAY_STATUS_LABEL[d.status] || 'not on the rolls yet'}${d.checkIn ? ` · ${istClock12(d.checkIn)}–${istClock12(d.checkOut)}` : ''}`}
                      >
                        {SHORT[d.status] ?? ''}
                      </span>
                    </td>
                  ))}
                  <td style={{ paddingLeft: 8, fontWeight: 700, color: r.summary.lopDays ? 'var(--red)' : 'var(--color-text-soft)' }}>{fmtDays(r.summary.lopDays)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
