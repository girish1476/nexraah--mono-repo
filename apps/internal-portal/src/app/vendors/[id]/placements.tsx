'use client';

import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '@/apis';
import { downloadCsv, todayStamp } from '@/lib/export-csv';
import { ErrorState, Loading, Panel, Tone, useToast } from '@/lib/ui';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, OrderStatus } from '../../orders/types';
import { getVendorPlacements } from '../apis';
import { VendorPlacement } from '../types';

/**
 * What a placement is *waiting on*, in plain words.
 *
 * Once an order exists its own step is the answer. Before that the only fact
 * is the indent's stage: awarded but no vehicle named yet, or vehicle named but
 * no trip yet. Both are real states a transporter can be stuck in, which is
 * why the list starts at the award rather than at the trip.
 */
function stateOf(p: VendorPlacement): { label: string; tone: Tone } {
  if (p.orderStatus && p.orderStatus in ORDER_STATUS_LABEL) {
    const status = p.orderStatus as OrderStatus;
    return { label: ORDER_STATUS_LABEL[status], tone: ORDER_STATUS_TONE[status] };
  }
  if (p.stage === 'VENDOR_ASSIGNED') return { label: 'Awarded — waiting for a vehicle', tone: 'flag' };
  if (p.stage === 'VEHICLE_PLACED') return { label: 'Vehicle named', tone: 'blue' };
  return { label: p.stage.replace(/_/g, ' ').toLowerCase(), tone: 'grey' };
}

/**
 * Loads placed with one transporter — the panel on `/vendors/[id]`.
 *
 * This used to list every load in a searchable table. All orders already does
 * that search, so the list was dropped (owner's direction, 2026-10-03): what
 * is left is the spreadsheet of this transporter's loads, narrowed by pickup
 * date when a from/to is given.
 */
export function VendorPlacements({ vendorId, vendorCode }: { vendorId: string; vendorCode: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<VendorPlacement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = () => {
    setError(null);
    getVendorPlacements(vendorId)
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [vendorId]);

  // Both ends inclusive, on the pickup date. A load with no pickup date only
  // shows when no range is set.
  const shown = useMemo(
    () =>
      (rows ?? []).filter((r) => {
        if (!from && !to) return true;
        const day = r.pickupDate?.slice(0, 10);
        if (!day) return false;
        return (!from || day >= from) && (!to || day <= to);
      }),
    [rows, from, to],
  );

  const exportRows = () => {
    const range = from || to ? `-${from || 'start'}-to-${to || todayStamp()}` : `-${todayStamp()}`;
    downloadCsv(
      `${vendorCode}-placements${range}.csv`,
      [
        'Load request',
        'Trip',
        'Client',
        'Route',
        'Material',
        'Weight (MT)',
        'Truck type',
        'Pickup date',
        'Vehicle no.',
        'Driver',
        'Driver licence',
        'Vehicle reported',
        'Where it stands',
        'Rate we pay (₹)',
        'Advance paid (₹)',
        'Balance paid (₹)',
        'Delivered on',
        'Proof of delivery',
      ],
      shown.map((r) => [
        r.indentCode,
        r.tripCode,
        r.clientName,
        r.lane,
        r.material,
        r.weightTn,
        r.truckType,
        r.pickupDate?.slice(0, 10),
        r.vehicleNo,
        r.driverName,
        r.driverLicence,
        r.placedAt?.slice(0, 10),
        stateOf(r).label,
        r.buyRatePaise === null ? null : r.buyRatePaise / 100,
        r.advancePaidPaise === null ? null : r.advancePaidPaise / 100,
        r.balancePaidPaise === null ? null : r.balancePaidPaise / 100,
        r.deliveredAt?.slice(0, 10),
        r.podStatus,
      ]),
    );
    toast(`Exported ${shown.length} placement${shown.length === 1 ? '' : 's'}`);
  };

  return (
    <Panel title="Loads placed with this transporter">
      {error ? (
        <ErrorState message={error} retry={load} />
      ) : !rows ? (
        <Loading what="Loading their loads" />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <span className="muted">Pickup from</span>
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12.5 }}>
              <span className="muted">Pickup to</span>
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
            <button className="btn btn-secondary" disabled={shown.length === 0} onClick={exportRows}>
              ⬇️ Download ({shown.length})
            </button>
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            {rows.length === 0
              ? 'No loads have been given to this transporter yet.'
              : shown.length === 0
                ? 'No loads were picked up in that range.'
                : 'Leave the dates empty to download every load. To look up a single load, search All orders.'}
          </p>
        </>
      )}
    </Panel>
  );
}
