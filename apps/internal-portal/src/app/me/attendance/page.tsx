'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { DAY_STATUS_LABEL } from '@/lib/hr/attendance';
import { dateLabel, dayLabel, hoursLabel, istClock, istClock12, istDate, monthLabel, monthOf, shiftMonth } from '@/lib/hr/calendar';
import { MyAttendance, getMyAttendance, raiseCorrection } from '@/lib/hr/apis';
import type { AttendanceDay } from '@/lib/hr/types';
import { Dialog, ErrorState, Field, Loading, ModuleGuard, PageHeader, Stack, StatStrip, useToast } from '@/lib/ui';
import { Card, DayPill, Empty, Legend, MonthCalendar, fmtDays } from '@/components/hr/hr-ui';

/** My calendar — `/me/attendance`. Every day of a month, and the way to fix one that is wrong. */
export default function MyAttendancePage() {
  const toast = useToast();
  const thisMonth = monthOf(istDate(new Date()));
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<MyAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<AttendanceDay | null>(null);
  const [fix, setFix] = useState<{ checkIn: string; checkOut: string; reason: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    getMyAttendance(month).then(setData).catch((e) => setError(errorMessage(e)));
  }, [month]);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;

  const today = istDate(new Date());
  const s = data?.summary;
  const earliest = data ? monthOf(data.joinedOn) : thisMonth;

  const submit = async () => {
    if (!day || !fix) return;
    setBusy(true);
    try {
      await raiseCorrection({ date: day.date, checkIn: fix.checkIn || null, checkOut: fix.checkOut || null, reason: fix.reason });
      toast('Correction sent to your manager');
      setFix(null);
      setDay(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModuleGuard module="me">
      <PageHeader
        title="My calendar"
        sub="Every day of the month. Tap a day to see it, or to fix a time that is wrong."
        module="me"
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} disabled={month <= earliest} aria-label="Previous month">
              ‹
            </button>
            <span style={{ fontWeight: 700, minWidth: 130, textAlign: 'center' }}>{monthLabel(month)}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth} aria-label="Next month">
              ›
            </button>
          </div>
        }
      />
      {!data || data.month !== month ? (
        <Loading what="Reading your month" />
      ) : (
        <Stack gap={16}>
          <StatStrip
            compact
            stats={[
              { k: 'Present', emoji: '✅', v: fmtDays((s?.present ?? 0) + (s?.onDuty ?? 0)), note: s?.onDuty ? `${s.onDuty} on duty away` : undefined },
              { k: 'Late', emoji: '⏰', v: s?.late ?? 0, tone: s?.late ? 'flag' : undefined },
              { k: 'On leave', emoji: '🌴', v: fmtDays(s?.onLeave ?? 0) },
              { k: 'Half days', emoji: '🌓', v: s?.halfDays ?? 0 },
              { k: 'Unpaid days', emoji: '🕳️', v: fmtDays(s?.lopDays ?? 0), tone: s?.lopDays ? 'red' : undefined, note: 'Absences and unpaid leave' },
              { k: 'Average day', emoji: '⌛', v: s?.avgWorkedMinutes ? hoursLabel(s.avgWorkedMinutes) : '—' },
            ]}
          />
          <Card title={monthLabel(month)} emoji="🗓️" right={<Legend statuses={['PRESENT', 'LATE', 'ON_DUTY', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'HOLIDAY']} />}>
            <MonthCalendar days={data.days} today={today} onPick={setDay} />
          </Card>
          <Card title="Corrections you asked for" emoji="🛠️">
            {data.corrections.length ? (
              <div className="hr-list">
                {data.corrections.map((c) => (
                  <div key={c.id} className="hr-row">
                    <div className="hr-row-main">
                      <div style={{ fontWeight: 650 }}>{dayLabel(c.date, true)}</div>
                      <div className="hr-muted">
                        In {istClock12(c.checkIn)} · out {istClock12(c.checkOut)} — “{c.reason}”
                        {c.decisionNote ? ` · Reply: “${c.decisionNote}”` : ''}
                      </div>
                    </div>
                    <DayPill status={c.status === 'APPROVED' ? 'PRESENT' : c.status === 'REJECTED' ? 'ABSENT' : 'LATE'}>
                      {c.status === 'APPROVED' ? 'Fixed' : c.status === 'REJECTED' ? 'Not accepted' : 'Waiting'}
                    </DayPill>
                  </div>
                ))}
              </div>
            ) : (
              <Empty emoji="👌">No corrections — every day has been right.</Empty>
            )}
          </Card>
        </Stack>
      )}

      <Dialog
        open={!!day && !fix}
        title={day ? dayLabel(day.date, true) : ''}
        facts={
          day
            ? [
                ['Status', day.status === 'NONE' ? '—' : <DayPill key="s" status={day.status}>{day.holidayName ?? DAY_STATUS_LABEL[day.status]}</DayPill>],
                ['Checked in', day.checkIn ? `${istClock12(day.checkIn)}${day.lateByMinutes > 0 ? ` (${day.lateByMinutes} min after the shift start)` : ''}` : '—'],
                ['Checked out', istClock12(day.checkOut)],
                ['Worked', day.workedMinutes ? hoursLabel(day.workedMinutes) : '—'],
                ['Where', day.inPlace ? (day.inPlace.withinBranch ? `At the office${day.inPlace.distanceM !== null ? ` · ${day.inPlace.distanceM} m` : ''}` : `Away — ${day.inPlace.note ?? 'no reason given'}`) : '—'],
                ...(day.note ? ([['Note', day.note]] as [string, string][]) : []),
              ]
            : undefined
        }
        confirmLabel={day?.correctionPending ? 'Close' : 'Something’s wrong — fix it'}
        onConfirm={() => {
          if (!day || day.correctionPending) return setDay(null);
          setFix({ checkIn: day.checkIn ? istClock(day.checkIn) : '', checkOut: day.checkOut ? istClock(day.checkOut) : '', reason: '' });
        }}
        onClose={() => setDay(null)}
      >
        {day?.correctionPending && <p className="hr-muted">A correction for this day is waiting for your manager.</p>}
      </Dialog>

      <Dialog
        open={!!fix}
        title={`Fix ${day ? dateLabel(day.date) : ''}`}
        body="Give the right times. Your manager approves it, and the day is corrected."
        confirmLabel="Send for approval"
        confirmDisabled={!fix || (!fix.checkIn && !fix.checkOut) || fix.reason.trim().length < 5}
        busy={busy}
        onConfirm={() => void submit()}
        onClose={() => setFix(null)}
      >
        {fix && (
          <Stack gap={12}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Checked in at">
                <input type="time" value={fix.checkIn} onChange={(e) => setFix({ ...fix, checkIn: e.target.value })} />
              </Field>
              <Field label="Checked out at">
                <input type="time" value={fix.checkOut} onChange={(e) => setFix({ ...fix, checkOut: e.target.value })} />
              </Field>
            </div>
            <Field label="What happened" hint="A short sentence is enough.">
              <input value={fix.reason} onChange={(e) => setFix({ ...fix, reason: e.target.value })} placeholder="e.g. Forgot to check out — left at 6:45 pm" autoFocus />
            </Field>
          </Stack>
        )}
      </Dialog>
    </ModuleGuard>
  );
}
