'use client';

import type { ReactNode } from 'react';
import { fmtDateTime } from '@/lib/format';
import { FactList, Panel } from '@/lib/ui';
import type { OrderDetail, OrderStepActor } from '../types';

const person = (name?: string | null, phone?: string | null) => [name, phone].filter(Boolean).join(' · ') || null;

/** Who did a step and when — or that it has not happened yet. */
const done = (a?: OrderStepActor | null): ReactNode => {
  if (!a?.at) return <span className="muted">Not yet</span>;
  const by = person(a.byName, a.byPhone);
  return (
    <>
      {by && <strong>{by}</strong>}
      <span className="muted">
        {by ? ' · ' : ''}
        {fmtDateTime(a.at)}
      </span>
    </>
  );
};

/**
 * The order's own steps, each with who did it and when: booked, vehicle
 * allocated, and the proof of delivery — the E-POD, then the signed hard copy
 * (H-POD) that follows it.
 *
 * Kept to the steps no other panel shows (owner's direction, 2026-10-04). The
 * advance documents have their own panel above, and where the truck is — the
 * loading point, loaded, on the road, unloaded — is the Tracking tab; listing
 * them again here said the same thing twice.
 */
export function OrderActivityList({ order }: { order: OrderDetail }) {
  const a = order.activity;
  // An H-POD that came straight in is the proof itself; an E-POD (or nothing
  // yet) is followed by the hard copy.
  const direct = a?.podKind === 'HPOD';

  const rows: [string, ReactNode][] = [
    ['Order booked', done(a?.booked)],
    ['Vehicle allocated', done(a?.vehicleAllocated)],
    ...(direct
      ? ([
          ['H-POD uploaded', done(a?.podUploaded)],
          ['H-POD verified', done(a?.podVerified)],
        ] as [string, ReactNode][])
      : ([
          ['E-POD uploaded', done(a?.podUploaded)],
          ['E-POD verified', done(a?.podVerified)],
          ['H-POD uploaded', done(a?.hardCopyUploaded)],
          ['H-POD verified', done(a?.hardCopyVerified)],
        ] as [string, ReactNode][])),
  ];

  return (
    <Panel title="🧾 Order details" pad={false}>
      <FactList facts={rows} />
    </Panel>
  );
}
