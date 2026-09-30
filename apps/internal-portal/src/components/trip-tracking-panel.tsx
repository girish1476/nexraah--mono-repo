'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getVehicleTracking } from '@/app/telematics/apis';
import { VehicleRow } from '@/app/telematics/types';
import { ALERT_LABEL, ALERT_TONE } from '@/lib/documents';
import { fmtDateTime } from '@/lib/format';
import { Panel, Tag } from '@/lib/ui';

/**
 * Live position of the truck on one trip — speed, fuel, where it is, how far
 * through its transit time, and any alert.
 *
 * One panel, used on the trip page and the order page, so the two never show
 * a vehicle in different states. Its own 30s refresh matches the fleet board
 * (`telematics/page.tsx`). A vehicle with no signal yet answers `null`, not an
 * error — tracking is supplementary, so it degrades to "no signal yet" rather
 * than failing the page it sits on.
 */
export function TripTrackingPanel({ vehicleNo, tripStage }: { vehicleNo: string | null; tripStage: string }) {
  const [tracking, setTracking] = useState<VehicleRow | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!vehicleNo) return;
    let cancelled = false;
    const poll = () => {
      getVehicleTracking(vehicleNo)
        .then((row) => {
          if (cancelled) return;
          setTracking(row);
          setChecked(true);
        })
        .catch(() => {
          if (!cancelled) setChecked(true);
        });
    };
    poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [vehicleNo]);

  return (
    <Panel title="📍 Vehicle tracking">
      {!vehicleNo ? (
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Tracking starts once a vehicle is allocated and the trip is started.
        </p>
      ) : tracking ? (
        <>
          <div className="stat-strip" style={{ border: 0 }}>
            <div>
              <div className="eyebrow">Speed</div>
              <div className="stat-value" style={{ color: tracking.alerts.includes('OVERSPEED') ? 'var(--red)' : undefined }}>
                {tracking.speedKmph} km/h
              </div>
            </div>
            <div>
              <div className="eyebrow">Fuel</div>
              <div className="stat-value">{tracking.fuelPct}%</div>
            </div>
            <div>
              <div className="eyebrow">Position</div>
              <div className="mono" style={{ fontSize: 13 }}>
                <a
                  href={`https://www.google.com/maps?q=${tracking.lat},${tracking.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open this position on a map"
                >
                  {tracking.lat.toFixed(4)}, {tracking.lng.toFixed(4)}
                </a>
              </div>
            </div>
            <div>
              <div className="eyebrow">Last ping</div>
              <div style={{ fontSize: 13 }}>{fmtDateTime(tracking.lastPingAt)}</div>
            </div>
          </div>
          <div style={{ padding: '0 14px 4px' }}>
            <div className="bar">
              <span style={{ width: `${tracking.progressPct}%` }} />
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
              {tracking.progressPct}% of expected transit time elapsed
            </div>
          </div>
          {tracking.alerts.length > 0 && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', padding: '10px 14px 4px' }}>
              {tracking.alerts.map((a) => (
                <Tag key={a} tone={ALERT_TONE[a]}>
                  {ALERT_LABEL[a]}
                </Tag>
              ))}
            </div>
          )}
          <p className="muted" style={{ fontSize: 11.5, padding: '10px 14px 0', marginBottom: 0 }}>
            <Link href="/telematics">See the full fleet board →</Link>
          </p>
        </>
      ) : checked ? (
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          {tripStage === 'CLOSED' || tripStage === 'DELIVERED'
            ? 'The trip is finished — the vehicle is no longer tracked.'
            : tripStage === 'OPEN'
              ? 'Tracking starts when the trip is started (marked departed).'
              : 'No tracking signal yet — nothing has pinged for this vehicle.'}
        </p>
      ) : (
        <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
          Checking for a signal…
        </p>
      )}
    </Panel>
  );
}
