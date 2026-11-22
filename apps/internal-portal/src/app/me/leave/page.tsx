'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { dateLabel, dayLabel } from '@/lib/hr/calendar';
import { LEAVE_STATUS_LABEL } from '@/lib/hr/leave';
import { MyLeave, applyLeave, cancelLeave, countLeaveDays, getMyLeave } from '@/lib/hr/apis';
import type { LeaveRequest } from '@/lib/hr/types';
import { Dialog, ErrorState, Field, Glyph, Loading, ModuleGuard, PageHeader, Stack, useToast } from '@/lib/ui';
import { Balance, Card, DayPill, Empty, HolidayRow, Tabs, daysWord } from '@/components/hr/hr-ui';

/** Leave — `/me/leave`. What is left, asking for time off, and what became of each request. */
export default function MyLeavePage() {
  return (
    <Suspense fallback={<Loading what="Opening your leave" />}>
      <LeaveScreen />
    </Suspense>
  );
}

const blank = { type: 'CL', from: '', to: '', halfDay: null as LeaveRequest['halfDay'], reason: '' };

function LeaveScreen() {
  const toast = useToast();
  const params = useSearchParams();
  const [data, setData] = useState<MyLeave | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<typeof blank | null>(null);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [tab, setTab] = useState<'requests' | 'holidays'>('requests');
  const [cancelling, setCancelling] = useState<LeaveRequest | null>(null);

  const load = useCallback(() => {
    setError(null);
    getMyLeave().then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (params.get('apply') === '1') setForm({ ...blank });
  }, [params]);

  // The day count follows the dates as they are typed — weekly offs and holidays come out.
  useEffect(() => {
    if (!form?.from) return setDays(null);
    const to = form.to || form.from;
    if (to < form.from) return setDays(0);
    let live = true;
    countLeaveDays(form.from, to, form.from === to ? form.halfDay : null)
      .then((r) => live && setDays(r.days))
      .catch(() => live && setDays(null));
    return () => {
      live = false;
    };
  }, [form?.from, form?.to, form?.halfDay]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Opening your leave" />;

  const type = data.types.find((t) => t.code === form?.type);
  const bal = data.balances.find((b) => b.code === form?.type);
  const nameOf = (code: string) => data.types.find((t) => t.code === code)?.name ?? code;
  const hueOf = (code: string) => data.types.find((t) => t.code === code)?.hue ?? 'var(--hr-leave)';

  const submit = async () => {
    if (!form) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await applyLeave({ ...form, to: form.to || form.from, halfDay: (form.to || form.from) === form.from ? form.halfDay : null });
      toast(`Sent to ${data.approverName} — ${daysWord(r.days)} of ${nameOf(r.type).toLowerCase()}`);
      setForm(null);
      load();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const doCancel = async () => {
    if (!cancelling) return;
    setBusy(true);
    try {
      await cancelLeave(cancelling.id);
      toast('Leave cancelled — the days are back in your balance');
      setCancelling(null);
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const upcoming = data.requests.filter((r) => r.status !== 'CANCELLED' && r.status !== 'REJECTED' && r.to >= data.today);

  return (
    <ModuleGuard module="me">
      <PageHeader
        title="Leave"
        sub={`What you have left this year, and your requests. Leave goes to ${data.approverName} to approve.`}
        module="me"
        right={
          <button className="btn" onClick={() => setForm({ ...blank })}>
            🌴 Apply for leave
          </button>
        }
      />
      <Stack gap={16}>
        <div className="hr-grid">
          {data.balances.map((b) => (
            <div key={b.code} className="hr-card" style={{ borderTop: `3px solid ${b.hue}` }}>
              <Balance b={b} size={66} />
              {b.paid && (
                <div className="hr-muted">
                  {b.quota} a year{b.carriedIn ? ` + ${b.carriedIn} carried in` : ''} · {b.used} taken
                </div>
              )}
            </div>
          ))}
        </div>

        {upcoming.length > 0 && (
          <Card title="Coming up" emoji="🧳">
            <div className="hr-list">
              {upcoming.map((r) => (
                <LeaveRow key={r.id} r={r} name={nameOf(r.type)} hue={hueOf(r.type)} today={data.today} onCancel={() => setCancelling(r)} />
              ))}
            </div>
          </Card>
        )}

        <Card
          title={tab === 'requests' ? 'All your requests' : `Holidays ${data.today.slice(0, 4)}`}
          emoji={tab === 'requests' ? '🗂️' : '🎉'}
          right={
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { id: 'requests', label: 'Requests' },
                { id: 'holidays', label: 'Holidays' },
              ]}
            />
          }
        >
          {tab === 'requests' ? (
            data.requests.length ? (
              <div className="hr-list">
                {data.requests.map((r) => (
                  <LeaveRow key={r.id} r={r} name={nameOf(r.type)} hue={hueOf(r.type)} today={data.today} onCancel={() => setCancelling(r)} />
                ))}
              </div>
            ) : (
              <Empty emoji="🏝️">No leave asked for yet this year.</Empty>
            )
          ) : (
            <div className="hr-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
              {data.holidays.filter((h) => !h.optional).map((h) => (
                <div key={h.id} style={{ opacity: h.date < data.today ? 0.5 : 1 }}>
                  <HolidayRow h={h} />
                </div>
              ))}
            </div>
          )}
        </Card>
      </Stack>

      <Dialog
        open={!!form}
        title="Apply for leave"
        body={`It goes to ${data.approverName}. You’ll see the answer here.`}
        confirmLabel={days ? `Ask for ${daysWord(days)}` : 'Ask for leave'}
        confirmDisabled={!form?.from || !form.reason.trim() || !days}
        busy={busy}
        onConfirm={() => void submit()}
        onClose={() => {
          setForm(null);
          setProblem(null);
        }}
        width={560}
      >
        {form && (
          <Stack gap={14}>
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-text-soft)', marginBottom: 6 }}>Kind of leave</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
                {data.types.map((t) => {
                  const b = data.balances.find((x) => x.code === t.code);
                  const on = form.type === t.code;
                  return (
                    <button
                      key={t.code}
                      type="button"
                      onClick={() => setForm({ ...form, type: t.code })}
                      aria-pressed={on}
                      style={{
                        textAlign: 'left',
                        padding: '10px 12px',
                        borderRadius: 12,
                        cursor: 'pointer',
                        font: 'inherit',
                        color: 'inherit',
                        border: `1.5px solid ${on ? t.hue : 'var(--color-divider)'}`,
                        background: on ? `color-mix(in srgb, ${t.hue} 10%, var(--color-surface))` : 'var(--color-surface)',
                      }}
                    >
                      <Glyph size={18}>{t.emoji}</Glyph>
                      <div style={{ fontWeight: 700, marginTop: 4 }}>{t.name}</div>
                      <div className="hr-muted">{t.paid ? `${b?.available ?? 0} left` : 'No limit, unpaid'}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="First day">
                <input type="date" value={form.from} min={type?.allowBackdated ? undefined : data.today} onChange={(e) => setForm({ ...form, from: e.target.value, to: form.to && form.to >= e.target.value ? form.to : e.target.value })} />
              </Field>
              <Field label="Last day">
                <input type="date" value={form.to} min={form.from || undefined} onChange={(e) => setForm({ ...form, to: e.target.value })} />
              </Field>
            </div>
            {form.from && (form.to || form.from) === form.from && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {([
                  [null, 'Whole day'],
                  ['FIRST', 'Morning off'],
                  ['SECOND', 'Afternoon off'],
                ] as const).map(([v, label]) => (
                  <button key={label} type="button" className={`btn btn-sm ${form.halfDay === v ? '' : 'btn-secondary'}`} onClick={() => setForm({ ...form, halfDay: v })}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            <Field label="Reason" hint="A few words — your manager sees it.">
              <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Sister’s wedding in Rajahmundry" />
            </Field>
            {days !== null && form.from && (
              <div className="hr-card" style={{ padding: '10px 14px', background: 'var(--color-surface-sunken)', boxShadow: 'none' }}>
                <strong>{days ? daysWord(days) : 'No working days'}</strong>
                <span className="hr-muted">
                  {' '}
                  · {dayLabel(form.from)}
                  {(form.to || form.from) !== form.from ? ` to ${dayLabel(form.to)}` : ''} — weekly offs and holidays are not counted
                  {type?.paid && bal ? ` · ${Math.max(0, bal.available - (days ?? 0))} ${type.name.toLowerCase()} left after this` : ''}
                </span>
              </div>
            )}
            {problem && (
              <div role="alert" style={{ color: 'var(--red)', fontWeight: 600 }}>
                {problem}
              </div>
            )}
          </Stack>
        )}
      </Dialog>

      <Dialog
        open={!!cancelling}
        title="Cancel this leave?"
        body={cancelling ? `${nameOf(cancelling.type)}, ${cancelling.from === cancelling.to ? dateLabel(cancelling.from) : `${dateLabel(cancelling.from)} to ${dateLabel(cancelling.to)}`}. The days go back into your balance.` : undefined}
        confirmLabel="Cancel the leave"
        busy={busy}
        onConfirm={() => void doCancel()}
        onClose={() => setCancelling(null)}
      />
    </ModuleGuard>
  );
}

function LeaveRow({ r, name, hue, today, onCancel }: { r: LeaveRequest; name: string; hue: string; today: string; onCancel: () => void }) {
  const cancellable = r.status === 'PENDING' || (r.status === 'APPROVED' && r.from > today);
  const tone = r.status === 'APPROVED' ? 'PRESENT' : r.status === 'PENDING' ? 'LATE' : r.status === 'REJECTED' ? 'ABSENT' : 'WEEKLY_OFF';
  return (
    <div className="hr-row">
      <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 4, background: hue, flex: 'none' }} />
      <div className="hr-row-main">
        <div style={{ fontWeight: 650 }}>
          {name} · {daysWord(r.days)}
          {r.halfDay ? (r.halfDay === 'FIRST' ? ' (morning)' : ' (afternoon)') : ''}
        </div>
        <div className="hr-muted">
          {r.from === r.to ? dayLabel(r.from, true) : `${dayLabel(r.from)} – ${dayLabel(r.to, true)}`} — “{r.reason}”
          {r.decisionNote ? ` · Reply: “${r.decisionNote}”` : ''}
        </div>
      </div>
      <div className="hr-row-actions" style={{ alignItems: 'center' }}>
        <DayPill status={tone}>{LEAVE_STATUS_LABEL[r.status]}</DayPill>
        {cancellable && (
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
