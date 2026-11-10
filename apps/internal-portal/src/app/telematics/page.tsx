'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDateTime } from '@/lib/format';
import { ALERT_LABEL, ALERT_TONE } from '@/lib/documents';
import {
  Column,
  DataTable,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Stack,
  StatStrip,
  Tag,
  useLevel,
  useToast,
} from '@/lib/ui';
import { PlacePicker } from '@/components/place-picker';
import { getTelematics, updateVehicleTelematics } from './apis';
import { AlertKind, TelematicsResponse, VehicleRow } from './types';

/** Alerts Ops can key in by hand. E-way *expired* is deliberately not one of them — see the page note below. */
const EDITABLE_ALERTS: AlertKind[] = ['OVERSPEED', 'LONG_HALT', 'DARK_VEHICLE', 'EWAY_EXPIRING'];

/**
 * Why this alert is on this row, said the way Ops would say it on the phone.
 *
 * A coloured pill reading "Overspeed" can only tell someone that something is
 * wrong; it never says "…at 96 km/h against an 80 limit". Every figure needed
 * is already on the row or in `config`, so the because costs nothing.
 */
function alertReason(
  kind: AlertKind,
  r: VehicleRow,
  config: TelematicsResponse['config'],
): string | undefined {
  switch (kind) {
    case 'OVERSPEED':
      return `${r.speedKmph} km/h · limit is ${config.overspeedKmph} km/h`;
    case 'LONG_HALT':
      return `Parked for longer than ${config.haltMinutes} min`;
    case 'DARK_VEHICLE':
      return `Nothing heard since ${fmtDateTime(r.lastPingAt)}`;
    case 'EWAY_EXPIRING':
      return r.ewayValidTill
        ? `E-way bill runs out ${fmtDateTime(r.ewayValidTill)}`
        : 'Expiry date not recorded';
    default:
      return undefined;
  }
}

function toCsvValue(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportToExcel(rows: VehicleRow[]) {
  // Same words as the on-screen columns — someone reading the download should
  // not have to translate it back to the board.
  const headers = [
    'Truck',
    'Trip number',
    'Transporter',
    'Route',
    'Progress %',
    'Speed (km/h)',
    'Fuel %',
    'Last update',
    'E-way bill valid till',
    'Alerts',
  ];
  const lines = [headers.join(',')];
  rows.forEach((r) => {
    lines.push(
      [
        r.vehicleNo,
        r.tripCode ?? '',
        r.vendorName,
        r.lane,
        r.progressPct,
        r.speedKmph,
        r.fuelPct,
        fmtDateTime(r.lastPingAt),
        r.ewayValidTill ? fmtDateTime(r.ewayValidTill) : '',
        r.alerts.map((a) => ALERT_LABEL[a] ?? a).join(' | '),
      ]
        .map(toCsvValue)
        .join(','),
    );
  });
  // BOM so Excel opens the UTF-8 file (₹, vendor names) without mangling it.
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fleet-board-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fleet board — `/telematics` (part 11 §1).
 *
 * No GPS provider is wired up — every row here is what Ops keys in by hand
 * after a call with the driver or transporter. E-way *expiring* is
 * surfaced and sorted to the top because it's actionable ahead of time;
 * E-way *expired* is not shown as a separate tile — by the time a truck is
 * already past the deadline the board isn't what prevents the checkpost
 * problem, so it no longer competes for attention here.
 */
export default function TelematicsPage() {
  const level = useLevel('telematics');
  const canEdit = level === 'EDIT';
  const toast = useToast();

  const [data, setData] = useState<TelematicsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<VehicleRow | null>(null);
  const [form, setForm] = useState<{
    speedKmph: number;
    fuelPct: number;
    lat: number;
    lng: number;
    ewayValidTill: string;
    alerts: AlertKind[];
  }>({ speedKmph: 0, fuelPct: 0, lat: 0, lng: 0, ewayValidTill: '', alerts: [] });
  const [saving, setSaving] = useState(false);
  // Which tile the list is narrowed to; null shows every truck.
  const [filter, setFilter] = useState<AlertKind | null>(null);

  const load = () => {
    setError(null);
    getTelematics().then(setData).catch((e) => setError(errorMessage(e)));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  // E-way expiring first — the one alert on this board a truck can still act on.
  const vehicles = useMemo(() => {
    if (!data) return [];
    return [...data.vehicles].sort(
      (a, b) => Number(b.alerts.includes('EWAY_EXPIRING')) - Number(a.alerts.includes('EWAY_EXPIRING')),
    );
  }, [data]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading the fleet board" />;

  // Trucks, not alert entries — the tile's number has to match the rows a click shows.
  const count = (kind: AlertKind) => data.vehicles.filter((v) => v.alerts.includes(kind)).length;
  const shownVehicles = filter ? vehicles.filter((v) => v.alerts.includes(filter)) : vehicles;
  const pick = (kind: AlertKind | null) => setFilter((f) => (kind === null || f === kind ? null : kind));
  const FILTER_EMPTY: Record<AlertKind, string> = {
    EWAY_EXPIRING: 'No truck has an e-way bill running out.',
    OVERSPEED: 'No truck is driving too fast.',
    LONG_HALT: 'No truck has been stopped too long.',
    DARK_VEHICLE: 'Every truck is still reporting its position.',
    EWAY_EXPIRED: 'No truck has an expired e-way bill.',
  };

  const toggleOne = (vehicleNo: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(vehicleNo)) next.delete(vehicleNo);
      else next.add(vehicleNo);
      return next;
    });

  const toggleAll = () =>
    setSelected((s) =>
      s.size === shownVehicles.length && shownVehicles.length > 0
        ? new Set()
        : new Set(shownVehicles.map((v) => v.vehicleNo)),
    );

  const doExport = () => {
    const rows = selected.size ? vehicles.filter((v) => selected.has(v.vehicleNo)) : shownVehicles;
    exportToExcel(rows);
    toast(`Downloaded ${rows.length} truck${rows.length === 1 ? '' : 's'} — the file opens in Excel`);
  };

  const openEdit = (r: VehicleRow) => {
    setEditing(r);
    setForm({
      speedKmph: r.speedKmph,
      fuelPct: r.fuelPct,
      lat: r.lat,
      lng: r.lng,
      ewayValidTill: r.ewayValidTill ? r.ewayValidTill.slice(0, 10) : '',
      alerts: r.alerts.filter((a) => (EDITABLE_ALERTS as string[]).includes(a)),
    });
  };

  const toggleAlert = (a: AlertKind) =>
    setForm((f) => ({ ...f, alerts: f.alerts.includes(a) ? f.alerts.filter((x) => x !== a) : [...f.alerts, a] }));

  const saveEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const updated = await updateVehicleTelematics(editing.vehicleNo, {
        speedKmph: form.speedKmph,
        fuelPct: form.fuelPct,
        lat: form.lat,
        lng: form.lng,
        ewayValidTill: form.ewayValidTill ? `${form.ewayValidTill}T23:59:00+05:30` : null,
        alerts: form.alerts,
      });
      setData((d) => (d ? { ...d, vehicles: d.vehicles.map((v) => (v.vehicleNo === updated.vehicleNo ? updated : v)) } : d));
      setEditing(null);
      toast(`${updated.vehicleNo} updated`);
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<VehicleRow>[] = [
    {
      key: 'select',
      label: '',
      render: (r) => (
        <input
          type="checkbox"
          checked={selected.has(r.vehicleNo)}
          onChange={() => toggleOne(r.vehicleNo)}
          aria-label={`Select ${r.vehicleNo}`}
        />
      ),
    },
    { key: 'vehicle', label: 'Vehicle', mono: true, render: (r) => r.vehicleNo },
    { key: 'trip', label: 'Trip number', mono: true, render: (r) => r.tripCode ?? '—' },
    { key: 'vendor', label: 'Transporter', render: (r) => r.vendorName },
    {
      key: 'lane',
      label: 'Route',
      render: (r) => (
        <div style={{ minWidth: 150 }}>
          <div>{r.lane}</div>
          <div className="bar" style={{ marginTop: 4 }}>
            <span style={{ width: `${r.progressPct}%` }} />
          </div>
          {/* The bar alone has no number and no legend — say what is filling up. */}
          <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
            {r.progressPct}% of the way there
          </div>
        </div>
      ),
    },
    {
      key: 'speed',
      label: 'Speed',
      align: 'right',
      render: (r) => (
        <span style={{ color: r.speedKmph > data.config.overspeedKmph ? 'var(--red)' : undefined }}>
          {r.speedKmph} km/h
        </span>
      ),
    },
    { key: 'fuel', label: 'Fuel', align: 'right', render: (r) => `${r.fuelPct}%` },
    { key: 'ping', label: 'Last update', render: (r) => fmtDateTime(r.lastPingAt) },
    {
      key: 'eway',
      label: 'E-way bill valid till',
      render: (r) => (r.ewayValidTill ? fmtDateTime(r.ewayValidTill) : 'No e-way bill on this leg'),
    },
    {
      key: 'alerts',
      label: 'Warnings',
      // E-way *expired* is off this board entirely (see the page note) — only ever surfaced as "expiring".
      render: (r) => {
        const shown = r.alerts.filter((a) => a !== 'EWAY_EXPIRED');
        return (
          // One alert per line: a pill and its reason read as a sentence, and
          // wrapping them side by side interleaves reasons with the next pill.
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shown.length === 0 ? (
              // Not "no data captured" — nothing is wrong with this truck, which
              // is the most useful thing this board can say about a row.
              <span className="muted">All clear</span>
            ) : (
              shown.map((a) => (
                <Tag key={a} tone={ALERT_TONE[a]} reason={alertReason(a, r, data.config)}>
                  {ALERT_LABEL[a]}
                </Tag>
              ))
            )}
          </div>
        );
      },
    },
    ...(canEdit
      ? [
          {
            key: 'act',
            label: '',
            align: 'right' as const,
            render: (r: VehicleRow) => (
              <button className="btn btn-secondary btn-sm" onClick={() => openEdit(r)}>
                Update
              </button>
            ),
          },
        ]
      : []),
  ];

  return (
    <ModuleGuard module="telematics">
      <PageHeader
        path="/telematics"
        // Renamed 2026-09-02 at the owner's direction — "Tracking" is what
        // people call it, and "live" was never true of a screen that also
        // shows a truck last heard from six hours ago.
        title="Tracking"
        module="telematics"
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={toggleAll} disabled={shownVehicles.length === 0}>
              {selected.size === shownVehicles.length && shownVehicles.length > 0 ? 'Clear selection' : 'Select all'}
            </button>
            <button className="btn" onClick={doExport} disabled={shownVehicles.length === 0 && selected.size === 0}>
              {selected.size ? `Export selected (${selected.size})` : 'Export to Excel'}
            </button>
          </div>
        }
      />
      <PageIntro
        what="Where the trucks currently carrying your loads are, and which ones need a phone call today."
        who="Operations watches this during transit."
      >
        A truck is flagged when it goes faster than {data.config.overspeedKmph} km/h, sits still for
        more than {data.config.haltMinutes} minutes, or stops reporting its position for{' '}
        {data.config.darkVehicleIntervalMinutes} minutes. Those limits are set in the control panel.
      </PageIntro>

      <Stack>
        {/* Each tile is a filter: click to see just those trucks, click again for all of them. */}
        <StatStrip
          compact
          stats={[
            {
              k: 'Vehicles we can see',
              emoji: '📍',
              v: data.vehicles.length,
              id: 'tracking-all',
              onClick: () => pick(null),
              active: filter === null,
            },
            ...(
              [
                ['EWAY_EXPIRING', 'E-way bill running out', '⏰', 'flag'],
                ['OVERSPEED', 'Driving too fast', '⚡', 'red'],
                ['LONG_HALT', 'Stopped too long', '🛑', 'flag'],
                ['DARK_VEHICLE', 'Gone quiet', '📵', 'flag'],
              ] as const
            ).map(([kind, k, emoji, tone]) => ({
              k,
              emoji,
              tone,
              v: count(kind),
              id: `tracking-${kind.toLowerCase().replace(/_/g, '-')}`,
              onClick: () => pick(kind),
              active: filter === kind,
            })),
          ]}
        />

        <Panel pad={false}>
          {filter && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '8px 14px',
                borderBottom: '1px solid var(--color-divider)',
                fontSize: 13,
              }}
            >
              <span>
                Showing {shownVehicles.length} of {vehicles.length} truck{vehicles.length === 1 ? '' : 's'} ·{' '}
                <strong>{ALERT_LABEL[filter] ?? filter}</strong>
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => pick(null)}>
                Show all trucks
              </button>
            </div>
          )}
          <DataTable
            columns={columns}
            rows={shownVehicles}
            rowKey={(r) => r.vehicleNo}
            empty={filter ? FILTER_EMPTY[filter] : 'No trucks in motion.'}
          />
          <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px' }}>
            {canEdit
              ? 'No GPS provider is wired up — Ops updates a truck’s position (by place name) and status by hand from the "Update" action, and the board refreshes every thirty seconds.'
              : 'No GPS provider is wired up — every row is a manual update from Ops, refreshed every thirty seconds.'}
          </div>
        </Panel>
      </Stack>

      <Dialog
        open={!!editing}
        title={editing ? `Update ${editing.vehicleNo}` : 'Update truck'}
        body="Key in what you were told — this replaces the truck's last known status on the board."
        confirmLabel="Save"
        busy={saving}
        onConfirm={saveEdit}
        onClose={() => setEditing(null)}
      >
        <Field label="Speed (km/h)">
          <input
            type="number"
            min={0}
            value={form.speedKmph}
            onChange={(e) => setForm((f) => ({ ...f, speedKmph: Number(e.target.value) || 0 }))}
          />
        </Field>
        {/*
          Position by place name: Ops is told "near the Nagpur bypass", not a
          latitude. The name is looked up and its point saved (`lat`/`lng`,
          what `ManualUpdateDto` takes); coordinates from a shared pin are
          still one click away inside the picker.
        */}
        {editing && (
          <PlacePicker
            key={editing.vehicleNo}
            value={{ lat: form.lat, lng: form.lng }}
            onChange={(p) => setForm((f) => ({ ...f, lat: p.lat, lng: p.lng }))}
          />
        )}
        <Field label="Fuel %">
          <input
            type="number"
            min={0}
            max={100}
            value={form.fuelPct}
            onChange={(e) => setForm((f) => ({ ...f, fuelPct: Number(e.target.value) || 0 }))}
          />
        </Field>
        <Field label="E-way valid till" hint="Leave blank if there's no e-way bill on this leg.">
          <input
            type="date"
            value={form.ewayValidTill}
            onChange={(e) => setForm((f) => ({ ...f, ewayValidTill: e.target.value }))}
          />
        </Field>
        <Field label="Alerts">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {EDITABLE_ALERTS.map((a) => (
              <label key={a} style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" checked={form.alerts.includes(a)} onChange={() => toggleAlert(a)} />
                {ALERT_LABEL[a]}
              </label>
            ))}
          </div>
        </Field>
      </Dialog>
    </ModuleGuard>
  );
}
