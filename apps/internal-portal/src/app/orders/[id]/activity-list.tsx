'use client';

import { useEffect, useState } from 'react';
import { getTracking, getTripDocuments } from '@/app/trips/apis';
import type { TrackingKind, TrackingSheet, TripDocument } from '@/app/trips/types';
import { fmtDateTime } from '@/lib/format';
import { Panel } from '@/lib/ui';
import type { OrderDetail, OrderStepActor } from '../types';

interface Line {
  label: string;
  /** Null until the step has happened. */
  at: string | null;
  /** "Name · phone" for each person who did it. */
  by: string | null;
}

const person = (name?: string | null, phone?: string | null) => [name, phone].filter(Boolean).join(' · ') || null;

/**
 * The order from booking to verified proof of delivery, one plain line a step:
 * what happened, who did it (name and phone), and when. Sits at the bottom of
 * Details — the panels above carry the detail, this is only the list.
 */
export function OrderActivityList({ order }: { order: OrderDetail }) {
  const { tripId, status } = order;
  const [sheet, setSheet] = useState<TrackingSheet | null>(null);
  const [docs, setDocs] = useState<TripDocument[]>([]);
  useEffect(() => {
    if (!tripId) return;
    getTracking(tripId).then(setSheet).catch(() => setSheet(null));
    getTripDocuments(tripId).then(setDocs).catch(() => setDocs([]));
  }, [tripId, status]);

  const step = (label: string, a?: OrderStepActor | null): Line => ({
    label,
    at: a?.at ?? null,
    by: person(a?.byName, a?.byPhone),
  });

  const updates = sheet?.updates ?? [];
  const milestone = (label: string, kind: TrackingKind, at?: string | null): Line => {
    const u = updates.find((x) => x.kind === kind);
    return { label, at: u?.recordedAt ?? at ?? null, by: person(u?.recordedByName, u?.recordedByPhone) };
  };

  // The advance documents are a set: everyone who did them, and when the last one was done.
  const advance = docs.filter((d) => d.gatesAdvance);
  const docsLine = (
    label: string,
    at: (d: TripDocument) => string | null,
    by: (d: TripDocument) => string | null,
    all: boolean,
  ): Line => {
    const done = advance.filter((d) => at(d));
    if (done.length === 0 || (all && done.length < advance.length)) return { label, at: null, by: null };
    const people = [...new Set(done.map(by).filter(Boolean))].join(', ');
    return { label, at: done.map((d) => at(d) as string).sort().pop() as string, by: people || null };
  };

  // One line for every update typed while the truck is on the road.
  const transit = updates.filter((u) => u.kind === 'DEPARTED' || u.kind === 'UPDATE');
  const pod = order.activity?.podKind === 'HPOD' ? 'H-POD' : 'E-POD';

  const lines: Line[] = [
    step('Order booked', order.activity?.booked),
    step('Vehicle allocated', order.activity?.vehicleAllocated),
    milestone('Truck reached loading point', 'REACHED_LOADING', sheet?.reachedLoadingAt),
    milestone('Truck loaded and load marked', 'LOADED', sheet?.loadedAt),
    docsLine(
      'Advance documents uploaded',
      (d) => d.uploadedAt,
      (d) => person(d.uploadedBy, d.uploadedByPhone),
      false,
    ),
    docsLine(
      'Advance documents verified',
      (d) => d.verifiedAt,
      (d) => person(d.verifiedBy, d.verifiedByPhone),
      true,
    ),
    ...(transit.length > 0
      ? transit.map((u) => ({
          label: `Truck in transit update${u.location ? ` · ${u.location}` : ''}`,
          at: u.recordedAt,
          by: person(u.recordedByName, u.recordedByPhone),
        }))
      : [{ label: 'Truck in transit update', at: null, by: null }]),
    milestone('Truck reached unloading point', 'REACHED', sheet?.reachedDestinationAt),
    milestone('Truck unloaded', 'UNLOADED', sheet?.deliveredAt),
    step(`${pod} uploaded`, order.activity?.podUploaded),
    step(`${pod} verified`, order.activity?.podVerified),
  ];

  return (
    <Panel title="🧾 Order details">
      <ol style={{ margin: 0, paddingLeft: 22, fontSize: 'var(--text-sm)', display: 'grid', gap: 6 }}>
        {lines.map((l, i) => (
          <li key={i} className={l.at ? undefined : 'muted'}>
            {l.label}
            {l.at ? (
              <>
                {' — '}
                {l.by && <strong>{l.by}</strong>}
                <span className="muted">
                  {l.by ? ' · ' : ''}
                  {fmtDateTime(l.at)}
                </span>
              </>
            ) : (
              ' — not yet'
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
