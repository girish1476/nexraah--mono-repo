'use client';

import { useCallback, useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { dayLabel, istDate } from '@/lib/hr/calendar';
import { HrSettings, addHoliday, getHrSettings, removeHoliday, saveHrSettings } from '@/lib/hr/apis';
import type { BranchPlace, HrPolicy } from '@/lib/hr/types';
import { ErrorState, Field, Loading, ModuleGuard, PageHeader, Stack, useToast } from '@/lib/ui';
import { Card, HolidayRow, Tabs, rupees } from '@/components/hr/hr-ui';

type Tab = 'policy' | 'offices' | 'leave' | 'holidays' | 'statutory';

/** Holidays & policies — `/hr/settings`. The rules every attendance day, leave request and payslip follows. */
export default function HrSettingsPage() {
  const toast = useToast();
  const [data, setData] = useState<HrSettings | null>(null);
  const [policy, setPolicy] = useState<HrPolicy | null>(null);
  const [places, setPlaces] = useState<BranchPlace[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('policy');
  const [busy, setBusy] = useState(false);
  const [hol, setHol] = useState({ date: '', name: '', optional: false });
  const [locating, setLocating] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    getHrSettings()
      .then((d) => {
        setData(d);
        setPolicy(structuredClone(d.policy));
        setPlaces(structuredClone(d.places));
      })
      .catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data || !policy) return <Loading what="Opening HR settings" />;
  const ro = !data.canEdit;
  const dirty = JSON.stringify(policy) !== JSON.stringify(data.policy) || JSON.stringify(places) !== JSON.stringify(data.places);

  const save = async () => {
    setBusy(true);
    try {
      await saveHrSettings({ policy, places });
      toast('Saved — the new rules apply from now on');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const hereFor = (code: string) => {
    if (!navigator.geolocation) return toast('This device cannot share its location.');
    setLocating(code);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPlaces(places.map((b) => (b.code === code ? { ...b, lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) } : b)));
        setLocating(null);
        toast(`Point set to where you are (±${Math.round(p.coords.accuracy)} m). Save to keep it.`);
      },
      () => {
        setLocating(null);
        toast('Location was not shared. Allow it in the browser, or type the point in.');
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const addHol = async () => {
    setBusy(true);
    try {
      await addHoliday(hol);
      toast(`${hol.name} added`);
      setHol({ date: '', name: '', optional: false });
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const num = (v: number, on: (n: number) => void, step = 1) => (
    <input type="number" step={step} disabled={ro} value={v} onChange={(e) => on(Number(e.target.value))} />
  );
  const today = istDate(new Date());
  const year = today.slice(0, 4);

  return (
    <ModuleGuard module="hr">
      <PageHeader
        title="Holidays & policies"
        sub="The rules attendance, leave and payroll follow. Changes apply from now — past months are not rewritten."
        module="hr"
        right={
          data.canEdit && tab !== 'holidays' && (
            <button className="btn" disabled={!dirty || busy} onClick={() => void save()}>
              {dirty ? 'Save changes' : 'Saved'}
            </button>
          )
        }
      />
      <Stack gap={14}>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'policy', label: 'Working day' },
            { id: 'offices', label: 'Office locations' },
            { id: 'leave', label: 'Leave quotas' },
            { id: 'holidays', label: 'Holidays' },
            { id: 'statutory', label: 'PF, ESI & tax' },
          ]}
        />

        {tab === 'policy' && (
          <div className="hr-grid is-2">
            <Card title="Shift" emoji="⏰">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Starts">
                  <input type="time" disabled={ro} value={policy.shiftStart} onChange={(e) => setPolicy({ ...policy, shiftStart: e.target.value })} />
                </Field>
                <Field label="Ends">
                  <input type="time" disabled={ro} value={policy.shiftEnd} onChange={(e) => setPolicy({ ...policy, shiftEnd: e.target.value })} />
                </Field>
                <Field label="Grace before late (minutes)">{num(policy.graceMinutes, (n) => setPolicy({ ...policy, graceMinutes: n }))}</Field>
                <Field label="Office radius (metres)" hint="Check-ins inside it count as at the office.">
                  {num(policy.geofenceMeters, (n) => setPolicy({ ...policy, geofenceMeters: n }), 50)}
                </Field>
                <Field label="Full day (hours)">{num(policy.fullDayMinutes / 60, (n) => setPolicy({ ...policy, fullDayMinutes: Math.round(n * 60) }), 0.5)}</Field>
                <Field label="Half day (hours)" hint="Less than this is not a day.">
                  {num(policy.halfDayMinutes / 60, (n) => setPolicy({ ...policy, halfDayMinutes: Math.round(n * 60) }), 0.5)}
                </Field>
              </div>
            </Card>
            <Card title="Weekly offs" emoji="🛋️">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => {
                  const on = policy.weeklyOffs.includes(i);
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={ro}
                      className={`btn btn-sm ${on ? '' : 'btn-secondary'}`}
                      onClick={() => setPolicy({ ...policy, weeklyOffs: on ? policy.weeklyOffs.filter((x) => x !== i) : [...policy.weeklyOffs, i].sort() })}
                      aria-pressed={on}
                    >
                      {d}
                    </button>
                  );
                })}
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input type="checkbox" disabled={ro} checked={policy.alternateSaturdaysOff} onChange={(e) => setPolicy({ ...policy, alternateSaturdaysOff: e.target.checked })} />
                Second and fourth Saturdays off
              </label>
              <div className="hr-muted">Weekly offs and holidays are never counted as leave, and working on one is shown as worked.</div>
            </Card>
          </div>
        )}

        {tab === 'offices' && (
          <Card title="Where each office is" emoji="📍">
            <div className="hr-muted">
              A check-in within {policy.geofenceMeters} m of the office counts as at the office; further away, the person says where they are and the day is on duty. Stand in the office and press “Use where I am” for an exact point.
            </div>
            <div className="hr-list">
              {places.map((b) => (
                <div key={b.code} className="hr-row">
                  <div className="hr-row-main">
                    <div style={{ fontWeight: 650 }}>
                      {b.name} <span className="hr-muted">· {b.state}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                      <input
                        aria-label={`${b.name} latitude`}
                        disabled={ro}
                        style={{ width: 130, padding: '6px 8px', border: '1px solid var(--color-divider-strong)', borderRadius: 8, background: 'var(--color-surface)', color: 'var(--color-text)' }}
                        value={b.lat}
                        onChange={(e) => setPlaces(places.map((x) => (x.code === b.code ? { ...x, lat: Number(e.target.value) || 0 } : x)))}
                      />
                      <input
                        aria-label={`${b.name} longitude`}
                        disabled={ro}
                        style={{ width: 130, padding: '6px 8px', border: '1px solid var(--color-divider-strong)', borderRadius: 8, background: 'var(--color-surface)', color: 'var(--color-text)' }}
                        value={b.lng}
                        onChange={(e) => setPlaces(places.map((x) => (x.code === b.code ? { ...x, lng: Number(e.target.value) || 0 } : x)))}
                      />
                      <a className="btn btn-secondary btn-sm" href={`https://www.google.com/maps?q=${b.lat},${b.lng}`} target="_blank" rel="noreferrer">
                        View on map ↗
                      </a>
                    </div>
                  </div>
                  {!ro && (
                    <button className="btn btn-secondary btn-sm" disabled={locating === b.code} onClick={() => hereFor(b.code)}>
                      {locating === b.code ? 'Finding you…' : '📍 Use where I am'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {tab === 'leave' && (
          <Card title="Leave each year" emoji="🌴">
            <div style={{ overflowX: 'auto' }}>
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Kind</th>
                    <th>Days a year</th>
                    <th>Added for each year of service</th>
                    <th>Most carried over</th>
                    <th>Paid</th>
                    <th>Can be taken after the day</th>
                  </tr>
                </thead>
                <tbody>
                  {policy.leaveTypes.map((t, i) => {
                    const set = (patch: Partial<typeof t>) => setPolicy({ ...policy, leaveTypes: policy.leaveTypes.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <tr key={t.code}>
                        <td style={{ fontWeight: 650 }}>
                          {t.emoji} {t.name}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="number" step={0.5} disabled={ro || !t.paid} style={{ width: 70 }} value={t.annualQuota} onChange={(e) => set({ annualQuota: Number(e.target.value) })} aria-label={`${t.name} days a year`} />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="number" step={0.5} disabled={ro || !t.paid} style={{ width: 70 }} value={t.increasePerYear ?? 0} onChange={(e) => set({ increasePerYear: Number(e.target.value) })} aria-label={`${t.name} added each year of service`} />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="number" disabled={ro || !t.paid} style={{ width: 70 }} value={t.carryForwardMax} onChange={(e) => set({ carryForwardMax: Number(e.target.value) })} aria-label={`${t.name} carried over`} />
                        </td>
                        <td style={{ textAlign: 'center' }}>{t.paid ? 'Yes' : 'No'}</td>
                        <td style={{ textAlign: 'center' }}>
                          <input type="checkbox" disabled={ro} checked={t.allowBackdated} onChange={(e) => set({ allowBackdated: e.target.checked })} aria-label={`${t.name} after the day`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hr-muted">
              The leave year runs January to December. A year of service counts once it is complete on 1 January — someone who joined in March 2024 gets two years’ worth in 2026. Unpaid leave has no limit; each day of it is taken off pay.
            </div>
          </Card>
        )}

        {tab === 'holidays' && (
          <div className="hr-grid is-2">
            <Card title={`Holidays ${year}–${Number(year) + 1}`} emoji="🎉">
              <div className="hr-list">
                {data.holidays
                  .filter((h) => h.date >= `${year}-01-01`)
                  .map((h) => (
                    <div key={h.id} className="hr-row" style={{ opacity: h.date < today ? 0.55 : 1 }}>
                      <div className="hr-row-main">
                        <HolidayRow h={h} />
                      </div>
                      {data.canEdit && h.date >= today && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() =>
                            void removeHoliday(h.id)
                              .then(() => {
                                toast(`${h.name} removed`);
                                load();
                              })
                              .catch((e) => toast(errorMessage(e)))
                          }
                          aria-label={`Remove ${h.name}`}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            </Card>
            {data.canEdit && (
              <Card title="Add a holiday" emoji="➕">
                <Field label="Date">
                  <input type="date" value={hol.date} onChange={(e) => setHol({ ...hol, date: e.target.value })} />
                </Field>
                <Field label="Name">
                  <input value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} placeholder="e.g. Ugadi" />
                </Field>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="checkbox" checked={hol.optional} onChange={(e) => setHol({ ...hol, optional: e.target.checked })} />
                  Optional — people may take it as leave, the office stays open
                </label>
                {hol.date && <div className="hr-muted">{dayLabel(hol.date, true)}</div>}
                <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={busy || !hol.date || hol.name.trim().length < 2} onClick={() => void addHol()}>
                  Add holiday
                </button>
              </Card>
            )}
          </div>
        )}

        {tab === 'statutory' && (
          <div className="hr-grid is-2">
            <Card title="Provident fund & ESI" emoji="🏛️">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="PF rate (%)">{num(policy.pfRatePct, (n) => setPolicy({ ...policy, pfRatePct: n }), 0.01)}</Field>
                <Field label="PF wage ceiling (₹)">{num(policy.pfWageCeilingPaise / 100, (n) => setPolicy({ ...policy, pfWageCeilingPaise: Math.round(n * 100) }))}</Field>
                <Field label="Pension (EPS) share (%)">{num(policy.epsRatePct, (n) => setPolicy({ ...policy, epsRatePct: n }), 0.01)}</Field>
                <Field label="ESI applies up to gross (₹)">{num(policy.esiGrossLimitPaise / 100, (n) => setPolicy({ ...policy, esiGrossLimitPaise: Math.round(n * 100) }))}</Field>
                <Field label="ESI — employee (%)">{num(policy.esiEmployeePct, (n) => setPolicy({ ...policy, esiEmployeePct: n }), 0.01)}</Field>
                <Field label="ESI — employer (%)">{num(policy.esiEmployerPct, (n) => setPolicy({ ...policy, esiEmployerPct: n }), 0.01)}</Field>
              </div>
              <div className="hr-muted">Statutory rates change by notification — have the company’s CA confirm these before the first payroll.</div>
            </Card>
            <Card title="Professional tax" emoji="🧾">
              {policy.ptTables.map((t) => (
                <div key={t.state}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{t.state}</div>
                  <div className="hr-list">
                    {t.slabs.map((s, i) => {
                      const from = i === 0 ? 0 : (t.slabs[i - 1].upToPaise ?? 0) + 100;
                      return (
                        <div key={i} className="hr-row" style={{ padding: '6px 0' }}>
                          <div className="hr-row-main hr-muted">
                            {s.upToPaise === null ? `Above ${rupees(from - 100)}` : `${rupees(from)} – ${rupees(s.upToPaise)}`}
                          </div>
                          <strong>{rupees(s.taxPaise)}</strong>
                          {s.februaryTaxPaise !== undefined && <span className="hr-muted">({rupees(s.februaryTaxPaise)} in Feb)</span>}
                        </div>
                      );
                    })}
                  </div>
                  {t.womenExemptUpToPaise && <div className="hr-muted">Women earning up to {rupees(t.womenExemptUpToPaise)} pay nothing.</div>}
                </div>
              ))}
            </Card>
          </div>
        )}
      </Stack>
    </ModuleGuard>
  );
}
