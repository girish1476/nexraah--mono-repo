'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@/apis';
import { fmtDateTime } from '@/lib/format';
import {
  Banner,
  Column,
  DataTable,
  ErrorState,
  Loading,
  ModuleGuard,
  PageHeader,
  Panel,
  Stack,
  StatStrip,
  Tag,
  Tone,
} from '@/lib/ui';
import { getTelematics } from './apis';
import { AlertKind, TelematicsResponse, VehicleRow } from './types';

const ALERT_LABEL: Record<AlertKind, string> = {
  OVERSPEED: 'Overspeed',
  LONG_HALT: 'Long halt',
  DARK_VEHICLE: 'No signal',
  EWAY_EXPIRING: 'E-way expiring',
  EWAY_EXPIRED: 'E-way expired',
};

const ALERT_TONE: Record<AlertKind, Tone> = {
  OVERSPEED: 'red',
  LONG_HALT: 'flag',
  DARK_VEHICLE: 'flag',
  EWAY_EXPIRING: 'flag',
  EWAY_EXPIRED: 'red',
};

/**
 * Fleet board — `/telematics` (part 11 §1).
 *
 * Thresholds come from the control panel and re-evaluate immediately when
 * they change; the board does not wait for the next ping.
 */
export default function TelematicsPage() {
  const [data, setData] = useState<TelematicsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getTelematics().then(setData).catch((e) => setError(errorMessage(e)));
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!data) return <Loading what="Loading the fleet board" />;

  const alerts = data.vehicles.flatMap((v) => v.alerts);
  const count = (kind: AlertKind) => alerts.filter((a) => a === kind).length;

  const columns: Column<VehicleRow>[] = [
    { key: 'vehicle', label: 'Truck', mono: true, render: (r) => r.vehicleNo },
    { key: 'trip', label: 'Trip', mono: true, render: (r) => r.tripCode ?? '—' },
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
    { key: 'ping', label: 'Last ping', render: (r) => fmtDateTime(r.lastPingAt) },
    { key: 'eway', label: 'E-way valid till', render: (r) => (r.ewayValidTill ? fmtDateTime(r.ewayValidTill) : '—') },
    {
      key: 'alerts',
      label: 'Alerts',
      render: (r) => (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {r.alerts.length === 0 ? (
            <span className="muted">—</span>
          ) : (
            r.alerts.map((a) => (
              <Tag key={a} tone={ALERT_TONE[a]}>
                {ALERT_LABEL[a]}
              </Tag>
            ))
          )}
        </div>
      ),
    },
  ];

  return (
    <ModuleGuard module="telematics">
      <PageHeader
        path="/telematics"
        title="Fleet board"
        sub={`Overspeed above ${data.config.overspeedKmph} km/h · halt beyond ${data.config.haltMinutes} min · dark after ${data.config.darkVehicleIntervalMinutes} min`}
        module="telematics"
      />

      <Stack>
        <StatStrip
          stats={[
            { k: 'Trucks tracked', v: data.vehicles.length },
            { k: 'Overspeed', v: count('OVERSPEED'), tone: 'red' },
            { k: 'Long halt', v: count('LONG_HALT'), tone: 'flag' },
            { k: 'No signal', v: count('DARK_VEHICLE'), tone: 'flag' },
            { k: 'E-way expiring', v: count('EWAY_EXPIRING'), tone: 'flag' },
            { k: 'E-way expired', v: count('EWAY_EXPIRED'), tone: 'red' },
          ]}
        />

        {count('EWAY_EXPIRED') > 0 && (
          <Banner tone="red" title="A truck is running on a lapsed e-way bill">
            Expiry is hard — there is no grace. A truck detained at a checkpost is the failure this board exists
            to prevent.
          </Banner>
        )}

        <Panel pad={false}>
          <DataTable columns={columns} rows={data.vehicles} rowKey={(r) => r.vehicleNo} empty="No trucks in motion." />
          <div className="muted" style={{ fontSize: 11.5, padding: '10px 14px' }}>
            Positions come from the provider webhook. Until a provider is connected the board runs against
            simulated pings and refreshes every thirty seconds.
          </div>
        </Panel>
      </Stack>
    </ModuleGuard>
  );
}
