'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { BalancePanel } from '@/components/balance-panel';
import { fmtDate, fmtDateTime, inr } from '@/lib/format';
import {
  Banner,
  ErrorState,
  FactList,
  Loading,
  ModuleGuard,
  PageHeader,
  PageIntro,
  Panel,
  Split,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
import { deliverTrip, departTrip, getTrip } from '../apis';
import { getVehicleTracking } from '@/app/telematics/apis';
import { VehicleRow } from '@/app/telematics/types';
import { ALERT_LABEL, ALERT_TONE, POD_STATUS_LABEL, POD_TONE } from '@/lib/documents';
import { TripDetail } from '../types';
import { TripTabs } from './tabs';

/** Trip detail — `/trips/[id]` (part 05 §2). */
export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const toast = useToast();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<VehicleRow | null>(null);
  const [trackingChecked, setTrackingChecked] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);

  const load = () => {
    setError(null);
    getTrip(id).then(setTrip).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  const submitDepart = async () => {
    setStageBusy(true);
    try {
      await departTrip(id);
      toast('Trip started — tracking begins now.');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setStageBusy(false);
    }
  };

  const submitDeliver = async () => {
    setStageBusy(true);
    try {
      await deliverTrip(id);
      toast('Marked delivered — the proof-of-delivery clock starts now.');
      load();
    } catch (e) {
      toast(errorMessage(e));
    } finally {
      setStageBusy(false);
    }
  };

  // Own effect, own vehicle number, own 30s refresh — same cadence as the
  // fleet board (`telematics/page.tsx`) so the two never show a vehicle in
  // different states. A vehicle with no open trip or no signal yet returns
  // `null`, not an error — most trips most of the time.
  useEffect(() => {
    if (!trip?.vehicleNo) return;
    let cancelled = false;
    const poll = () => {
      getVehicleTracking(trip.vehicleNo).then((row) => {
        if (!cancelled) {
          setTracking(row);
          setTrackingChecked(true);
        }
      });
      // Errors here are not surfaced as a page-level failure — the trip
      // itself loaded fine; tracking is supplementary, so it degrades to
      // "not tracked yet" rather than blocking the screen.
    };
    poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [trip?.vehicleNo]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!trip) return <Loading what="Loading the trip" />;

  const chargeCost = trip.charges.reduce((a, c) => a + c.costAmountPaise, 0);
  const chargeBilled = trip.charges.reduce((a, c) => a + c.billedAmountPaise, 0);
  const utilisation = trip.capacityTn ? Math.round((trip.weightTn / trip.capacityTn) * 100) : 0;

  return (
    <ModuleGuard module="trips">
      <PageHeader
        path={`/trips/${trip.code}`}
        title={trip.code}
        sub={`${trip.lane} · ${trip.distanceKm} km · ${trip.vendorName}`}
        module="trips"
        right={
          <Link href={`/orders/${trip.indentCode}`} className="btn btn-secondary">
            View order
          </Link>
        }
      />
      <PageIntro
        what="Everything about one trip in one place — the truck and driver assigned, live tracking while it's on the road, the money moved so far, and the documents, cross-check and lorry receipt needed to close it out."
        who="Operations runs the trip from here; finance releases the advance and balance payments shown below."
      />
      <TripTabs tripId={trip.id} />

      <Split
        aside={
          <>
            <Panel title="Identifiers" pad={false}>
              <FactList
                facts={[
                  ['Stage', <Tag key="stage" tone="grey">{trip.stage.replace(/_/g, ' ')}</Tag>],
                  ['Trip', trip.code],
                  ['Lorry receipt', trip.lrCode ?? 'not issued'],
                  ['Indent', <Link key="i" href={`/indents/${trip.indentId}`}>{trip.indentCode}</Link>],
                  ['Client', trip.clientName],
                  ['Transporter', trip.vendorName],
                  ['Branch', trip.branchName],
                ]}
              />
            </Panel>
            <Panel title="Truck and driver" pad={false}>
              <FactList
                facts={[
                  ['Vehicle', trip.vehicleNo],
                  ['Type', `${trip.vehicleType} · ${trip.capacityTn} MT`],
                  ['Load', `${trip.weightTn} MT`],
                  ['Utilisation', `${utilisation}%`],
                  ['Driver', trip.driverName],
                  ['Licence', trip.driverLicence],
                  ['Phone', trip.driverPhone ?? '—'],
                ]}
              />
              <div style={{ padding: '0 14px 12px' }}>
                <div className="bar">
                  <span style={{ width: `${Math.min(100, utilisation)}%` }} />
                </div>
              </div>
            </Panel>
            <Panel title="Money" pad={false}>
              <FactList
                facts={[
                  ['Buy rate', inr(trip.buyRatePaise)],
                  ['Charges (cost)', inr(chargeCost)],
                  ['Charges (billed)', inr(chargeBilled)],
                  ['Advance paid', inr(trip.advancePaidPaise)],
                  ['Balance paid', inr(trip.balancePaidPaise)],
                  ['POD penalty', inr(trip.podPenaltyPaise)],
                ]}
              />
            </Panel>
          </>
        }
      >
        <Panel title="Timing">
          <div className="stat-strip" style={{ border: 0 }}>
            <div>
              <div className="eyebrow">Transit required</div>
              <div className="stat-value">{trip.transitDaysRequired}d</div>
            </div>
            <div>
              <div className="eyebrow">Transit actual</div>
              <div className="stat-value" style={{ color: trip.transitDelay ? 'var(--red)' : 'var(--mint)' }}>
                {trip.actualTransitDays ?? '—'}
                {trip.actualTransitDays ? 'd' : ''}
              </div>
            </div>
            <div>
              <div className="eyebrow">Delivered</div>
              <div className="stat-value" style={{ fontSize: 16 }}>
                {fmtDate(trip.deliveredAt)}
              </div>
            </div>
            <div>
              <div className="eyebrow">Proof of delivery</div>
              <div style={{ marginTop: 6 }}>
                <Tag tone={POD_TONE[trip.podStatus] as Tone}>{POD_STATUS_LABEL[trip.podStatus] ?? trip.podStatus}</Tag>
              </div>
            </div>
          </div>
          {trip.transitDelay && (
            <div style={{ marginTop: 12 }}>
              <Banner tone="flag" title="Transit delay">
                Reporting was later than the client’s requirement — that on its own counts as the delay, not
                merely a risk of one.
              </Banner>
            </div>
          )}
          {trip.remarks && (
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0, marginTop: 12 }}>
              Remarks carried from the indent: {trip.remarks}
            </p>
          )}
          {can('indent.manage') && trip.stage === 'OPEN' && (
            <div style={{ marginTop: 12 }}>
              {trip.lr?.status === 'RELEASED' ? (
                <button className="btn" onClick={submitDepart} disabled={stageBusy}>
                  Start trip — mark departed
                </button>
              ) : (
                <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
                  Generate the lorry receipt before this trip can start.
                </p>
              )}
            </div>
          )}
          {can('indent.manage') && trip.stage === 'IN_TRANSIT' && (
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={submitDeliver} disabled={stageBusy}>
                Mark delivered
              </button>
            </div>
          )}
        </Panel>

        <Panel title="Vehicle tracking">
          {tracking ? (
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
                    {tracking.lat.toFixed(4)}, {tracking.lng.toFixed(4)}
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
          ) : trackingChecked ? (
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
              {trip.stage === 'CLOSED' || trip.stage === 'DELIVERED'
                ? 'No tracking signal was received while this trip was open.'
                : 'No tracking signal yet — nothing has pinged for this vehicle.'}
            </p>
          ) : (
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
              Checking for a signal…
            </p>
          )}
        </Panel>

        {trip.buyRatePaise > 0 && <AdvancePanel indentId={trip.indentId} onReleased={load} />}
        {trip.deliveredAt && <BalancePanel tripId={trip.id} onReleased={load} />}

        <Panel title="E-way bill">
          <FactList
            facts={[
              ['Number', trip.ewayNo ?? 'not captured'],
              ['Valid till', trip.ewayValidTill ? fmtDateTime(trip.ewayValidTill) : '—'],
            ]}
          />
          <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
            A truck detained at a checkpost on a lapsed e-way bill is the failure this exists to prevent. Expiry
            is hard — there is no grace.
          </p>
        </Panel>
      </Split>
    </ModuleGuard>
  );
}
