'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { isWeeklyOff } from '@/lib/hr/attendance';
import { dateLabel, dayLabel, istDate, monthLabel, monthOf, shiftMonth } from '@/lib/hr/calendar';
import { LEAVE_STATUS_LABEL } from '@/lib/hr/leave';
import { DEFAULT_POLICY } from '@/lib/hr/policy';
import { LeaveDesk, getLeaveDesk } from '@/lib/hr/apis';
import { ErrorState, Loading, ModuleGuard, PageHeader, Stack, StatStrip } from '@/lib/ui';
import { Card, DayPill, Empty, Person, Tabs, daysWord, fmtDays } from '@/components/hr/hr-ui';
import { PendingList } from '@/components/hr/pending-list';

type Tab = 'pending' | 'calendar' | 'balances' | 'decided';

/** Leave — `/hr/leave`. Requests to decide, who is away when, everyone's balance, and what was decided. */
export default function HrLeavePage() {
  const [month, setMonth] = useState(monthOf(istDate(new Date())));
  const [data, setData] = useState<LeaveDesk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('pending');

  const load = useCallback(() => {
    setError(null);
    getLeaveDesk(month).then(setData).catch((e) => setError(errorMessage(e)));
  }, [month]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Opening the leave desk" />;

  const today = istDate(new Date());
  const awayToday = data.calendar.filter((l) => l.status === 'APPROVED' && l.from <= today && today <= l.to).length;
  const pendingDays = data.pending.reduce((a, p) => a + (p.leave?.days ?? 0), 0);
  const people = [...new Map(data.calendar.map((l) => [l.employeeId, l.employeeName])).entries()];

  return (
    <ModuleGuard module="hr">
      <PageHeader title="Leave" sub="Decide what is waiting, see who is away, and keep an eye on balances." module="hr" />
      <Stack gap={14}>
        <StatStrip
          compact
          stats={[
            { k: 'Waiting for a decision', emoji: '✋', v: data.pending.length, tone: data.pending.length ? 'flag' : undefined, note: data.pending.length ? `${fmtDays(pendingDays)} days asked for` : undefined },
            { k: 'Away today', emoji: '🌴', v: awayToday },
            { k: `Leave in ${monthLabel(month).split(' ')[0]}`, emoji: '📅', v: data.calendar.filter((l) => l.status === 'APPROVED').length, note: 'approved requests' },
          ]}
        />
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'pending', label: `To decide${data.pending.length ? ` (${data.pending.length})` : ''}` },
            { id: 'calendar', label: 'Who is away' },
            { id: 'balances', label: 'Balances' },
            { id: 'decided', label: 'Recently decided' },
          ]}
        />

        {tab === 'pending' && (
          <Card title="Waiting for a decision" emoji="✋">
            <div className="hr-muted">Managers can decide their own team’s requests from My HR; anything here can be decided by HR.</div>
            <PendingList items={data.pending} onDone={load} empty="No leave waiting — everyone has an answer." />
          </Card>
        )}

        {tab === 'calendar' && (
          <Card
            title={monthLabel(month)}
            emoji="🗓️"
            right={
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
                  ‹
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month">
                  ›
                </button>
              </div>
            }
          >
            {people.length ? (
              <div className="away">
                <div className="away-grid" style={{ gridTemplateColumns: `160px repeat(${data.dates.length}, minmax(18px, 1fr))` }}>
                  <div />
                  {data.dates.map((d) => (
                    <div key={d} className="bars-lab" style={{ textAlign: 'center', fontWeight: d === today ? 800 : 500 }}>
                      {Number(d.slice(8))}
                    </div>
                  ))}
                  {people.map(([id, name]) => {
                    const mine = data.calendar.filter((l) => l.employeeId === id);
                    return [
                      <div key={`${id}-n`} style={{ fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', alignSelf: 'center' }}>
                        {name}
                      </div>,
                      ...data.dates.map((d) => {
                        const l = mine.find((x) => x.from <= d && d <= x.to);
                        const off = isWeeklyOff(d, DEFAULT_POLICY);
                        if (!l) return <div key={`${id}-${d}`} className={`away-cell${off ? ' is-off' : ''}`} />;
                        const first = d === l.from || d === data.dates[0];
                        return (
                          <div
                            key={`${id}-${d}`}
                            className={`away-bar${l.status === 'PENDING' ? ' is-pending' : ''}`}
                            style={{ background: l.hue, opacity: off ? 0.55 : 1 }}
                            title={`${name} · ${l.typeName} · ${dateLabel(l.from)}–${dateLabel(l.to)} · ${LEAVE_STATUS_LABEL[l.status]}`}
                          >
                            {first ? l.typeName.split(' ')[0] : ''}
                          </div>
                        );
                      }),
                    ];
                  })}
                </div>
              </div>
            ) : (
              <Empty emoji="🏢">Nobody has leave in {monthLabel(month)}.</Empty>
            )}
            <div className="pay-legend">
              {data.types.map((t) => (
                <span key={t.code}>
                  <i style={{ background: t.hue }} />
                  {t.name}
                </span>
              ))}
              <span>Striped = waiting for approval</span>
            </div>
          </Card>
        )}

        {tab === 'balances' && (
          <Card title={`Leave left, ${today.slice(0, 4)}`} emoji="⚖️">
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Person</th>
                    {data.types.filter((t) => t.paid).map((t) => (
                      <th key={t.code} style={{ textAlign: 'right' }}>
                        {t.emoji} {t.name}
                      </th>
                    ))}
                    <th style={{ textAlign: 'right' }}>Unpaid taken</th>
                  </tr>
                </thead>
                <tbody>
                  {data.balances.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <Person name={p.name} sub={p.code} size={28} />
                      </td>
                      {p.balances.filter((b) => b.paid).map((b) => (
                        <td key={b.code} style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          <strong>{fmtDays(b.available)}</strong>
                          <span className="hr-muted"> / {fmtDays(b.quota + b.carriedIn)}</span>
                          {b.pending ? <div className="hr-muted">{fmtDays(b.pending)} waiting</div> : null}
                        </td>
                      ))}
                      <td style={{ textAlign: 'right' }}>{fmtDays(p.balances.find((b) => !b.paid)?.used ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === 'decided' && (
          <Card title="Recently decided" emoji="🗂️">
            {data.recent.length ? (
              <div className="hr-list">
                {data.recent.map((l) => (
                  <div key={l.id} className="hr-row">
                    <div className="hr-row-main">
                      <Person
                        name={l.employeeName}
                        size={32}
                        sub={`${l.typeName} · ${daysWord(l.days)} · ${l.from === l.to ? dayLabel(l.from, true) : `${dayLabel(l.from)} – ${dayLabel(l.to, true)}`}${l.decidedByName ? ` · by ${l.decidedByName}` : ''}`}
                      />
                    </div>
                    <DayPill status={l.status === 'APPROVED' ? 'PRESENT' : l.status === 'REJECTED' ? 'ABSENT' : 'WEEKLY_OFF'}>{LEAVE_STATUS_LABEL[l.status]}</DayPill>
                  </div>
                ))}
              </div>
            ) : (
              <Empty emoji="📭">Nothing decided yet.</Empty>
            )}
          </Card>
        )}
      </Stack>
    </ModuleGuard>
  );
}
