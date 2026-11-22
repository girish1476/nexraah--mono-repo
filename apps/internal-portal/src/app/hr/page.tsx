'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { dateLabel, dayLabel } from '@/lib/hr/calendar';
import { HrOverview, getHrOverview } from '@/lib/hr/apis';
import { ErrorState, Loading, ModuleGuard, Stack, StatStrip, useCan } from '@/lib/ui';
import { Card, Empty, HolidayRow, Person, RUN_WORD, Ring, rupees } from '@/components/hr/hr-ui';
import { PendingList } from '@/components/hr/pending-list';

/**
 * People overview — `/hr`, where the HR login lands. Who is in today, what
 * is waiting on HR, attendance over the last fortnight, the month's payroll,
 * and the birthdays worth a message.
 */
export default function HrOverviewPage() {
  const canManage = useCan()('hr.manage');
  const [data, setData] = useState<HrOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setError(null);
    getHrOverview().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Gathering the people picture" />;

  const s = data.status;
  const inNow = s.in + s.onDuty;
  const working = data.headcount - s.off;
  const waiting = data.pending.length + data.changes.length;
  const run = data.payroll.run;

  return (
    <ModuleGuard module="hr">
      <Stack gap={18}>
        <section className="hr-hero is-people" aria-label="Today">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="hr-hero-eyebrow">People · {dayLabel(data.date, true)}</div>
            <h1 className="hr-hero-title">
              {data.dayOff ? `${data.dayOff} today 🌿` : `${inNow} of ${working} in today`}
            </h1>
            <p className="hr-hero-sub">
              {data.dayOff
                ? `The office is closed. ${inNow ? `${inNow} ${inNow === 1 ? 'person is' : 'people are'} working anyway.` : 'Nobody is expected in.'} ${waiting ? `${waiting} request${waiting === 1 ? '' : 's'} can still be cleared below.` : ''}`
                : `${s.late} late · ${s.onDuty} on duty away · ${s.onLeave} on leave · ${s.notYet} not checked in yet.`}
            </p>
            <div className="hr-hero-chips">
              <span className="hr-chip">👥 {data.headcount} on the rolls</span>
              {waiting > 0 && <span className="hr-chip is-warn">✋ {waiting} waiting on HR</span>}
              <span className={`hr-chip ${run?.status === 'RELEASED' ? 'is-ok' : ''}`}>
                🏦 {data.payroll.label}: {run ? RUN_WORD[run.status] : 'payroll not started'}
              </span>
            </div>
          </div>
          {!data.dayOff && (
            <div style={{ position: 'relative', zIndex: 1 }}>
              <Ring value={inNow} max={Math.max(working, 1)} size={150} stroke={12} color="#fff" track="rgba(255,255,255,0.22)">
                <span style={{ color: '#fff', textAlign: 'center', lineHeight: 1.1 }}>
                  <span style={{ fontSize: 34 }}>{working ? Math.round((inNow / working) * 100) : 0}%</span>
                  <br />
                  <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>in today</span>
                </span>
              </Ring>
            </div>
          )}
        </section>

        <StatStrip
          stats={[
            { k: 'Waiting on HR', emoji: '✋', v: waiting, tone: waiting ? 'flag' : undefined, note: 'Leave, corrections, bank changes' },
            { k: 'On leave today', emoji: '🌴', v: s.onLeave },
            { k: 'Not in yet', emoji: '⏳', v: s.notYet + s.absent, tone: s.notYet + s.absent && !data.dayOff ? 'red' : undefined },
            { k: 'Late today', emoji: '⏰', v: s.late, tone: s.late ? 'flag' : undefined },
            { k: `Payroll · ${data.payroll.label.split(' ')[0]}`, emoji: '🏦', v: run ? rupees(run.netPaise) : '—', note: run ? RUN_WORD[run.status] : 'Not started' },
          ]}
        />

        <div className="hr-grid is-2">
          <Card title="Waiting for a decision" emoji="✋" right={<Link href="/hr/leave" className="btn btn-secondary btn-sm">Leave desk</Link>}>
            <PendingList items={data.pending} changes={data.changes} onDone={load} canDecideChanges={canManage} />
          </Card>

          <Stack gap={16}>
            <Card title="Attendance, last 14 working days" emoji="📈">
              <div className="bars">
                {data.trend.map((t) => (
                  <div key={t.date} title={`${dayLabel(t.date)}: ${t.present} of ${t.total} in`}>
                    {/* From 60% up: the days differ by a person or two, which a bar from zero hides. */}
                    <div className="bars-col" style={{ height: `${Math.max(6, ((t.present / Math.max(t.total, 1) - 0.6) / 0.4) * 100)}%` }} />
                    <span className="bars-lab">{t.date.slice(8)}</span>
                  </div>
                ))}
              </div>
              <div className="hr-muted">
                {data.trend.length
                  ? `On average ${Math.round((data.trend.reduce((a, t) => a + t.present / Math.max(t.total, 1), 0) / data.trend.length) * 100)}% of people were in.`
                  : 'No working days recorded yet.'}
              </div>
            </Card>
            <Card title="By branch" emoji="🏬">
              <Stack gap={12}>
                {data.branches.map((b) => (
                  <div key={b.code}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                      <span style={{ fontWeight: 650 }}>{b.name}</span>
                      <span className="hr-muted">
                        {b.in} of {b.total} in
                      </span>
                    </div>
                    <div className="meter">
                      <span style={{ width: `${(b.in / Math.max(b.total, 1)) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </Stack>
            </Card>
          </Stack>
        </div>

        <div className="hr-grid">
          <Card title="Not in yet" emoji="📵" right={<Link href="/hr/attendance" className="btn btn-secondary btn-sm">Today’s board</Link>}>
            {data.dayOff ? (
              <Empty emoji="🌿">A day off — nobody is expected.</Empty>
            ) : data.notIn.length ? (
              <div className="hr-list">
                {data.notIn.slice(0, 6).map((p) => (
                  <div key={p.id} className="hr-row">
                    <div className="hr-row-main">
                      <Person name={p.name} sub={`${p.designation} · ${p.branchName}`} size={32} />
                    </div>
                    <a className="btn btn-secondary btn-sm" href={`tel:+91${p.phone}`}>
                      📞 Call
                    </a>
                  </div>
                ))}
              </div>
            ) : (
              <Empty emoji="🙌">Everyone expected today has checked in.</Empty>
            )}
          </Card>

          <Card title="On leave today" emoji="🌴">
            {data.onLeaveToday.length ? (
              <div className="hr-list">
                {data.onLeaveToday.map((p) => (
                  <div key={p.id} className="hr-row">
                    <div className="hr-row-main">
                      <Person name={p.name} sub={`${p.type} · back after ${dateLabel(p.until)}`} size={32} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty emoji="🏢">Nobody is on leave today.</Empty>
            )}
          </Card>

          <Card title={`Payroll · ${data.payroll.label}`} emoji="🏦" right={<Link href={run ? `/hr/payroll/${run.id}` : '/hr/payroll'} className="btn btn-sm">{run ? 'Open' : 'Start'}</Link>}>
            {run ? (
              <>
                <div className="hr-big">{rupees(run.netPaise)}</div>
                <div className="hr-muted">
                  Take-home for {run.headcount} people · {RUN_WORD[run.status]}
                  {run.preparedByName ? ` · prepared by ${run.preparedByName}` : ''}
                </div>
              </>
            ) : (
              <>
                <div className="hr-muted">
                  {data.payroll.label} hasn’t been started.
                  {data.payroll.last ? ` ${data.payroll.last.label} paid ${rupees(data.payroll.last.netPaise)} to ${data.payroll.last.headcount} people.` : ''}
                </div>
                <div className="hr-muted">Start it after the month’s attendance is settled — usually on the last working day.</div>
              </>
            )}
          </Card>

          <Card title="Celebrations" emoji="🎂">
            {data.celebrations.length ? (
              <div className="hr-list">
                {data.celebrations.map((c) => (
                  <div key={c.name + c.kind} className="hr-row">
                    <div className="hr-row-main">
                      <Person
                        name={c.name}
                        size={32}
                        sub={
                          c.kind === 'BIRTHDAY'
                            ? `🎂 Birthday · ${dayLabel(c.date)}`
                            : `🎉 ${c.years} year${c.years === 1 ? '' : 's'} at Nexraah · ${dayLabel(c.date)}`
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty emoji="🎈">No birthdays or work anniversaries in the next month.</Empty>
            )}
          </Card>

          <Card title="Holidays coming" emoji="🎉" right={<Link href="/hr/settings" className="btn btn-secondary btn-sm">Holiday list</Link>}>
            <Stack gap={12}>
              {data.upcomingHolidays.map((h) => (
                <HolidayRow key={h.id} h={h} />
              ))}
            </Stack>
          </Card>

          <Card title="People" emoji="🧑‍🤝‍🧑" right={<Link href="/hr/employees" className="btn btn-secondary btn-sm">Everyone</Link>}>
            <Stack gap={8}>
              {data.departments.map((d) => (
                <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{d.name}</span>
                  <strong>{d.count}</strong>
                </div>
              ))}
            </Stack>
            {data.newJoiners.length > 0 && (
              <div className="hr-muted">
                New: {data.newJoiners.map((j) => `${j.name} (${dateLabel(j.joinedOn)})`).join(', ')}
              </div>
            )}
          </Card>
        </div>
      </Stack>
    </ModuleGuard>
  );
}
