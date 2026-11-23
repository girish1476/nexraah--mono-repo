'use client';

import Link from 'next/link';
import { PayslipDownload } from '@/components/hr/payslip-download';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, errorMessage } from '@/apis';
import { DAY_STATUS_LABEL } from '@/lib/hr/attendance';
import { hoursLabel, istClock12, minutesOf, monthLabel } from '@/lib/hr/calendar';
import { MyHr, checkIn, checkOut, decideCorrection, decideLeave, getMyHr } from '@/lib/hr/apis';
import type { PendingItem } from '@/lib/hr/types';
import { Dialog, ErrorState, Field, Glyph, Loading, ModuleGuard, Stack, useToast } from '@/lib/ui';
import {
  Avatar,
  Balance,
  Card,
  DayPill,
  Empty,
  HolidayRow,
  LiveClock,
  Person,
  Ring,
  WeekStrip,
  fmtDays,
  rupees,
  useNow,
} from '@/components/hr/hr-ui';

/**
 * My HR — `/me`. Every person's own page, whatever their desk: check in and
 * out, the week, leave left, the latest payslip, holidays — and, for anyone
 * people report to, their team's day and what is waiting on them.
 */

type Coords = { lat: number; lng: number; accuracy: number } | null;

/** The phone's position, or null when it cannot be had (refused, no GPS, too slow). */
function locate(): Promise<Coords> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 9000, maximumAge: 60_000 },
    );
  });
}

const REASONS = ['Client visit', 'At the port / loading point', 'Travelling for work', 'Working from home'];

function greeting(now: Date | null): string {
  if (!now) return 'Hello';
  const h = Number(now.toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }));
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function MyHrPage() {
  const toast = useToast();
  const now = useNow(30_000);
  const [data, setData] = useState<MyHr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [away, setAway] = useState<{ message: string; coords: Coords } | null>(null);
  const [note, setNote] = useState('');
  const [confirmOut, setConfirmOut] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getMyHr().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Opening My HR" />;

  const { today, employee, policy } = data;
  const first = employee.name.split(' ')[0].replace(/\.$/, '') || employee.name;
  const checkedIn = !!today.checkIn;
  const checkedOut = !!today.checkOut;
  const offDay = today.status === 'WEEKLY_OFF' || today.status === 'HOLIDAY';
  const onLeave = today.status === 'ON_LEAVE' && !checkedIn;
  const worked = today.workedMinutes;

  const punchIn = async (withNote?: string, known?: Coords) => {
    setBusy(true);
    try {
      const coords = known !== undefined ? known : await locate();
      const day = await checkIn({ ...(coords ?? {}), ...(withNote ? { note: withNote } : {}) });
      setAway(null);
      setNote('');
      toast(`Checked in at ${istClock12(day.checkIn)}${day.status === 'ON_DUTY' ? ' — on duty' : day.status === 'LATE' ? ' — marked late' : ''}`);
      load();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'OUTSIDE_BRANCH' || e.code === 'LOCATION_UNKNOWN')) {
        const coords = known !== undefined ? known : null;
        setAway({ message: e.message, coords: coords ?? (await locate()) });
      } else toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const punchOut = async () => {
    setBusy(true);
    setConfirmOut(false);
    try {
      const coords = await locate();
      const day = await checkOut({ ...(coords ?? {}) });
      toast(`Checked out at ${istClock12(day.checkOut)} · ${hoursLabel(day.workedMinutes)} today`);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onPunch = () => {
    if (!checkedIn) return void punchIn();
    if (!checkedOut) {
      if (worked < policy.fullDayMinutes) setConfirmOut(true);
      else void punchOut();
    }
  };

  const sentence = (() => {
    if (onLeave) return `You are on leave today — enjoy it. Nothing to mark.`;
    if (checkedOut) return `Done for today: in at ${istClock12(today.checkIn)}, out at ${istClock12(today.checkOut)} — ${hoursLabel(worked)} worked.`;
    if (checkedIn)
      return `You checked in at ${istClock12(today.checkIn)}${today.status === 'ON_DUTY' ? ', on duty away from the office' : ''}. ${hoursLabel(worked)} so far — check out when you leave.`;
    if (offDay) return `${today.holidayName ? `It’s ${today.holidayName}` : 'It’s your weekly off'} — enjoy the day. Working anyway? You can still check in.`;
    const nowMin = now ? Number(now.toLocaleString('en-IN', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' })) * 60 + now.getMinutes() : 0;
    return nowMin > minutesOf(policy.shiftStart) + policy.graceMinutes
      ? `You haven’t checked in yet — your shift started at ${to12(policy.shiftStart)}. Tap the button when you arrive.`
      : `Your shift starts at ${to12(policy.shiftStart)}. Tap the button when you arrive at ${data.branch.name}.`;
  })();

  const place = today.inPlace;
  const presentDays = data.month.present + data.month.onDuty;

  return (
    <ModuleGuard module="me">
      <Stack gap={18}>
        <section className="hr-hero" aria-label="Today">
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div className="hr-hero-eyebrow">My HR · {data.branch.name}</div>
            <h1 className="hr-hero-title">
              {greeting(now)}, {first} {checkedOut ? '🌙' : checkedIn ? '💪' : offDay ? '🌿' : '👋'}
            </h1>
            <p className="hr-hero-sub">{sentence}</p>
            <div className="hr-hero-chips">
              {place && (
                <span className={`hr-chip ${place.withinBranch ? 'is-ok' : 'is-warn'}`}>
                  📍{' '}
                  {place.withinBranch
                    ? `At ${data.branch.name}${place.distanceM !== null ? ` · ${place.distanceM} m` : ''}`
                    : `On duty · ${place.note ?? 'away from the office'}`}
                </span>
              )}
              <span className="hr-chip">
                ⏰ Shift {to12(policy.shiftStart)} – {to12(policy.shiftEnd)}
              </span>
              <span className="hr-chip">
                ✅ {fmtDays(presentDays)} day{presentDays === 1 ? '' : 's'} in {monthLabel(data.month.month).split(' ')[0]}
              </span>
              {today.status !== 'NONE' && today.status !== 'NOT_YET' && (
                <span className="hr-chip">Today: {DAY_STATUS_LABEL[today.status]}</span>
              )}
            </div>
          </div>
          <div className="punch" style={{ position: 'relative', zIndex: 1 }}>
            <LiveClock />
            <button
              type="button"
              className={`punch-btn${checkedIn && !checkedOut ? ' is-out' : ''}${checkedOut || onLeave ? ' is-done' : ''}`}
              onClick={onPunch}
              disabled={busy || checkedOut || onLeave}
              aria-label={checkedOut ? 'Done for today' : checkedIn ? 'Check out' : 'Check in'}
            >
              {!checkedIn && !onLeave && !busy && <span className="punch-pulse" aria-hidden="true" />}
              <span className="ring">
                <Ring
                  value={checkedIn ? worked : 0}
                  max={policy.fullDayMinutes}
                  size={176}
                  stroke={9}
                  color={checkedOut ? 'var(--hr-present)' : 'var(--area-self)'}
                  track="rgba(0,0,0,0.06)"
                />
              </span>
              <span className="punch-btn-label">
                <Glyph size={30}>{busy ? '⏳' : checkedOut ? '✅' : onLeave ? '🌴' : checkedIn ? '👋' : '👆'}</Glyph>
                {busy ? 'One moment…' : checkedOut ? 'Done' : onLeave ? 'On leave' : checkedIn ? 'Check out' : 'Check in'}
                <span className="punch-btn-sub">
                  {checkedIn ? hoursLabel(worked) : busy ? 'Finding you' : 'with your location'}
                </span>
              </span>
            </button>
          </div>
        </section>

        <div className="hr-grid">
          <Card title="Your week" emoji="📆" right={<Link href="/me/attendance" className="btn btn-secondary btn-sm">Full calendar</Link>}>
            <WeekStrip days={data.week} today={today.date} fullDayMinutes={policy.fullDayMinutes} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8 }}>
              {[
                ['Present', presentDays, 'var(--hr-present)'],
                ['Late', data.month.late, 'var(--hr-late)'],
                ['On leave', data.month.onLeave, 'var(--hr-leave)'],
                ['Unpaid', data.month.lopDays, 'var(--hr-absent)'],
              ].map(([k, v, c]) => (
                <div key={k as string} style={{ borderLeft: `3px solid ${c}`, paddingLeft: 8 }}>
                  <div className="hr-muted" style={{ fontSize: 11.5 }}>
                    {k}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{fmtDays(v as number)}</div>
                </div>
              ))}
            </div>
            <div className="hr-muted">
              {monthLabel(data.month.month)} so far
              {data.month.avgWorkedMinutes ? ` · ${hoursLabel(data.month.avgWorkedMinutes)} on an average day` : ''}
            </div>
          </Card>

          <Card title="Leave left" emoji="🌴" right={<Link href="/me/leave?apply=1" className="btn btn-sm">Apply for leave</Link>}>
            <Stack gap={14}>
              {data.balances.filter((b) => b.paid).map((b) => (
                <Balance key={b.code} b={b} />
              ))}
            </Stack>
          </Card>

          <Card title="Latest payslip" emoji="💰" right={<Link href="/me/payslips" className="btn btn-secondary btn-sm">All payslips</Link>}>
            {data.latestPayslip ? (
              <>
                <div>
                  <div className="hr-muted">Paid for {monthLabel(data.latestPayslip.month)}</div>
                  <div className="hr-big">{rupees(data.latestPayslip.netPaise)}</div>
                </div>
                <div className="pay-split" aria-hidden="true">
                  <span style={{ width: `${(data.latestPayslip.netPaise / data.latestPayslip.grossPaise) * 100}%`, background: 'var(--hr-present)' }} />
                  <span style={{ width: `${(data.latestPayslip.deductionsPaise / data.latestPayslip.grossPaise) * 100}%`, background: 'var(--hr-late)' }} />
                </div>
                <div className="pay-legend">
                  <span>
                    <i style={{ background: 'var(--hr-present)' }} />
                    Take-home {rupees(data.latestPayslip.netPaise)}
                  </span>
                  <span>
                    <i style={{ background: 'var(--hr-late)' }} />
                    Deductions {rupees(data.latestPayslip.deductionsPaise)}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <PayslipDownload id={data.latestPayslip.id} />
                  <Link href={`/print/payslip/${data.latestPayslip.id}`} className="btn btn-secondary btn-sm" target="_blank">
                    View
                  </Link>
                </div>
              </>
            ) : (
              <Empty emoji="🧾">Your first payslip appears here once HR releases a month.</Empty>
            )}
          </Card>

          <Card title="Coming up" emoji="🎉">
            {data.holidays.length ? (
              <Stack gap={12}>
                {data.holidays.map((h) => (
                  <HolidayRow key={h.id} h={h} />
                ))}
              </Stack>
            ) : (
              <Empty emoji="📅">No holidays left on the list this year.</Empty>
            )}
          </Card>

          {data.myPending.length > 0 && (
            <Card title="Waiting on others" emoji="⏳" right={<Link href="/me/leave" className="btn btn-secondary btn-sm">My requests</Link>}>
              <div className="hr-list">
                {data.myPending.map((p) => (
                  <div key={p.id} className="hr-row">
                    <div className="hr-row-main">
                      <div style={{ fontWeight: 650 }}>{p.title}</div>
                      <div className="hr-muted">{p.detail}</div>
                    </div>
                    <DayPill status="LATE">Waiting</DayPill>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {data.team && <TeamCard team={data.team} reload={load} />}
      </Stack>

      <Dialog
        open={!!away}
        title="Where are you working today?"
        body={away?.message}
        confirmLabel="Check in"
        confirmDisabled={note.trim().length < 3}
        busy={busy}
        onConfirm={() => void punchIn(note.trim(), away?.coords ?? null)}
        onClose={() => {
          setAway(null);
          setNote('');
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
          {REASONS.map((r) => (
            <button key={r} type="button" className={`btn btn-sm ${note === r ? '' : 'btn-secondary'}`} onClick={() => setNote(r)}>
              {r}
            </button>
          ))}
        </div>
        <Field label="In your words" hint="Your manager sees this beside the day — it is marked on duty, not absent.">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Loading at Gangavaram port" autoFocus />
        </Field>
      </Dialog>

      <Dialog
        open={confirmOut}
        title="Check out now?"
        body={`You have worked ${hoursLabel(worked)} today. A full day is ${hoursLabel(policy.fullDayMinutes)} — leaving now ${
          worked < 4 * 60 ? 'does not count as a working day' : 'counts as a half day'
        }, unless you apply for leave for the rest.`}
        confirmLabel="Check out"
        busy={busy}
        onConfirm={() => void punchOut()}
        onClose={() => setConfirmOut(false)}
      />
    </ModuleGuard>
  );
}

function to12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** The manager's corner: who is in, and one-tap decisions on what is waiting. */
function TeamCard({ team, reload }: { team: NonNullable<MyHr['team']>; reload: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PendingItem | null>(null);
  const [why, setWhy] = useState('');
  const inCount = team.today.filter((m) => ['PRESENT', 'LATE', 'ON_DUTY', 'HALF_DAY'].includes(m.day.status)).length;

  const decide = async (p: PendingItem, decision: 'APPROVE' | 'REJECT', note?: string) => {
    setBusy(p.id);
    try {
      if (p.kind === 'LEAVE') await decideLeave(p.id, decision, note);
      else await decideCorrection(p.id, decision, note);
      toast(`${decision === 'APPROVE' ? 'Approved' : 'Declined'} — ${p.employeeName} has been told`);
      setDeclining(null);
      setWhy('');
      reload();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="hr-grid is-2">
      <Card title="My team today" emoji="👥" right={<span className="hr-muted">{inCount} of {team.size} in</span>}>
        <div className="hr-list">
          {team.today.map((m) => (
            <div key={m.id} className="hr-row">
              <div className="hr-row-main">
                <Person name={m.name} sub={m.designation} size={34} />
              </div>
              <div style={{ textAlign: 'right' }}>
                <DayPill status={m.day.status} />
                {m.day.checkIn && <div className="hr-muted" style={{ marginTop: 3 }}>in {istClock12(m.day.checkIn)}</div>}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Waiting on you" emoji="✋" right={team.pending.length ? <span className="nav-badge">{team.pending.length}</span> : undefined}>
        {team.pending.length ? (
          <div className="hr-list">
            {team.pending.map((p) => (
              <div key={p.id} className="hr-row">
                <Avatar name={p.employeeName} size={34} />
                <div className="hr-row-main">
                  <div style={{ fontWeight: 650 }}>
                    {p.employeeName} <span className="hr-muted">· {p.title}</span>
                  </div>
                  <div className="hr-muted">{p.detail}</div>
                </div>
                <div className="hr-row-actions">
                  <button className="btn btn-sm" disabled={busy === p.id} onClick={() => void decide(p, 'APPROVE')}>
                    Approve
                  </button>
                  <button className="btn btn-secondary btn-sm" disabled={busy === p.id} onClick={() => setDeclining(p)}>
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty emoji="🎈">Nothing waiting — your team is all sorted.</Empty>
        )}
      </Card>
      <Dialog
        open={!!declining}
        title={`Decline ${declining?.employeeName.split(' ')[0]}’s request?`}
        body={declining ? `${declining.title} — ${declining.detail}` : undefined}
        confirmLabel="Decline"
        confirmDisabled={why.trim().length < 3}
        busy={!!busy}
        onConfirm={() => declining && void decide(declining, 'REJECT', why.trim())}
        onClose={() => setDeclining(null)}
      >
        <Field label="Tell them why" hint="They see this, so they can plan around it.">
          <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Month-end close that week — can we move it?" autoFocus />
        </Field>
      </Dialog>
    </div>
  );
}
