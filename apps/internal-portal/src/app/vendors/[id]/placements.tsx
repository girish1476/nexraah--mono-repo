'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { errorMessage } from '@/apis';
import { downloadCsv, todayStamp } from '@/lib/export-csv';
import { fmtDate, inr } from '@/lib/format';
import {
  Column,
  DataTable,
  EmptyState,
  ErrorState,
  Loading,
  Panel,
  Tag,
  Tone,
  useCan,
  useToast,
} from '@/lib/ui';
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

/** Same rule the orders list uses to squash a truck number, so "MH 12 AB 1234" finds "MH12AB1234". */
const squash = (v: string | null | undefined) => (v ?? '').toLowerCase().replace(/[\s-]+/g, '');

/**
 * Loads placed with one transporter — the panel on `/vendors/[id]`.
 *
 * The vendor file used to say "41 trips" and stop there: nobody could open the
 * number and see which loads it was made of. This is that list, with the
 * vehicle and driver each load was placed on, where the order stands now, and
 * a spreadsheet export of whatever the search is currently showing.
 */
export function VendorPlacements({ vendorId, vendorCode }: { vendorId: string; vendorCode: string }) {
  const can = useCan();
  const toast = useToast();
  const [rows, setRows] = useState<VendorPlacement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('');

  const load = () => {
    setError(null);
    getVendorPlacements(vendorId)
      .then(setRows)
      .catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [vendorId]);

  const stateOptions = useMemo(
    () => Array.from(new Set((rows ?? []).map((r) => stateOf(r).label))).sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const needle = squash(q);
    return (rows ?? []).filter((r) => {
      if (state && stateOf(r).label !== state) return false;
      if (!needle) return true;
      return [r.indentCode, r.tripCode, r.clientName, r.lane, r.vehicleNo, r.driverName, r.material].some(
        (v) => squash(v).includes(needle),
      );
    });
  }, [rows, q, state]);

  const exportRows = () => {
    downloadCsv(
      `${vendorCode}-placements-${todayStamp()}.csv`,
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

  const columns: Column<VendorPlacement>[] = [
    {
      key: 'order',
      label: 'Order',
      primary: true,
      render: (r) =>
        can('indent.view') ? (
          <Link href={`/orders/${r.indentId}`} className="mono" style={{ fontSize: 12 }}>
            {r.indentCode}
          </Link>
        ) : (
          <span className="mono" style={{ fontSize: 12 }}>
            {r.indentCode}
          </span>
        ),
    },
    { key: 'client', label: 'Client', render: (r) => r.clientName },
    {
      key: 'lane',
      label: 'Route',
      render: (r) => r.lane,
      sub: (r) => `${r.material} · ${r.weightTn} MT · ${r.truckType}`,
    },
    { key: 'pickup', label: 'Pickup', render: (r) => fmtDate(r.pickupDate) },
    {
      key: 'vehicle',
      label: 'Vehicle placed',
      render: (r) =>
        r.vehicleNo ? (
          <span className="mono" style={{ fontSize: 12 }}>
            {r.vehicleNo}
          </span>
        ) : (
          <span className="muted">Not yet</span>
        ),
      sub: (r) => (r.driverName ? `${r.driverName}${r.placedAt ? ` · reported ${fmtDate(r.placedAt)}` : ''}` : ''),
    },
    {
      key: 'state',
      label: 'Where it stands',
      render: (r) => {
        const s = stateOf(r);
        return <Tag tone={s.tone}>{s.label}</Tag>;
      },
      sub: (r) => (r.tripCode ? `Trip ${r.tripCode}` : ''),
    },
    {
      key: 'rate',
      label: 'Rate we pay',
      align: 'right',
      render: (r) => (r.buyRatePaise === null ? '—' : inr(r.buyRatePaise)),
    },
  ];

  return (
    <Panel
      title="Loads placed with this transporter"
      pad={false}
      right={
        <button className="btn btn-secondary btn-sm" disabled={shown.length === 0} onClick={exportRows}>
          ⬇️ Export {shown.length === (rows?.length ?? 0) ? 'all' : 'these'} ({shown.length})
        </button>
      }
    >
      {error ? (
        <ErrorState message={error} retry={load} />
      ) : !rows ? (
        <Loading what="Loading their loads" />
      ) : (
        <>
          <div
            style={{ display: 'flex', gap: 10, flexWrap: 'wrap', padding: '12px 14px' }}
            role="search"
            aria-label="Search this transporter’s loads"
          >
            <input
              style={{ flex: '1 1 240px' }}
              type="search"
              placeholder="Order, client, city, truck number or driver"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              style={{ flex: '0 1 240px' }}
              value={state}
              onChange={(e) => setState(e.target.value)}
              aria-label="Where it stands"
            >
              <option value="">Any stage</option>
              {stateOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <DataTable
            columns={columns}
            rows={shown}
            rowKey={(r) => r.indentId}
            empty={
              rows.length === 0 ? (
                <EmptyState
                  emoji="🚛"
                  title="No loads have been given to this transporter yet"
                  hint="A load appears here the moment it is awarded to them, before any vehicle is named."
                />
              ) : (
                <EmptyState emoji="🔎" title="Nothing matches that search" hint="Clear the search or pick another stage." />
              )
            }
          />
        </>
      )}
    </Panel>
  );
}
