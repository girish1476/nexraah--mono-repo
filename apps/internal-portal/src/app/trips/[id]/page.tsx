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
  Panel,
  Split,
  Tag,
  Tone,
} from '@/lib/ui';
import { getTrip } from '../apis';
import { POD_TONE } from '@/lib/documents';
import { TripDetail } from '../types';
import { TripTabs } from './tabs';

/** Trip detail — `/trips/[id]` (part 05 §2). */
export default function TripDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getTrip(id).then(setTrip).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

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
      />
      <TripTabs tripId={trip.id} />

      <Split
        aside={
          <>
            <Panel title="Identifiers" pad={false}>
              <FactList
                facts={[
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
                <Tag tone={POD_TONE[trip.podStatus] as Tone}>{trip.podStatus}</Tag>
              </div>
            </div>
          </div>
          {trip.transitDelay && (
            <div style={{ marginTop: 12 }}>
              <Banner tone="flag" title="Transit delay">
                Reporting was later than the client’s requirement. Under BR-42 that is the delay, not merely a
                risk of one.
              </Banner>
            </div>
          )}
          {trip.remarks && (
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0, marginTop: 12 }}>
              Remarks carried from the indent: {trip.remarks}
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
