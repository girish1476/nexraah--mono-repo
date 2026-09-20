'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { errorMessage } from '@/apis';
import { AdvancePanel } from '@/components/advance-panel';
import { BalancePanel } from '@/components/balance-panel';
import { fmtDate, inr } from '@/lib/format';
import { ErrorState, FactList, Loading, ModuleGuard, PageHeader, PageIntro, Panel, Split, Stack, Tag } from '@/lib/ui';
import { getOrder } from '../apis';
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, OrderDetail, OrderStatus } from '../types';

/** The stretch of the ladder where "go verify the POD" is the live action. */
const POD_ACTIONABLE_STATUSES: OrderStatus[] = ['UNLOADED', 'POD_UPLOADED', 'POD_VERIFIED'];

/**
 * `/orders/[id]` — the whole lifecycle of one order, one screen. The
 * timeline and facts are read-only (composed from indent/trip/invoice), but
 * the advance and balance gates are the real, permission-checked panels also
 * used on the indent/trip pages and the payment queues — releasing money
 * here does the same thing releasing it there does, because it's the same
 * component.
 */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    getOrder(id).then(setOrder).catch((e) => setError(errorMessage(e)));
  };
  useEffect(load, [id]);

  if (error) return <ErrorState message={error} retry={load} />;
  if (!order) return <Loading what="Loading the order" />;

  return (
    <ModuleGuard module="orders">
      <PageHeader
        title={order.orderNo}
        sub={`${order.clientName} · ${order.lane} · from ${order.indentCode}`}
        module="orders"
        right={<Tag tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABEL[order.status]}</Tag>}
      />
      <PageIntro
        what="Everything about one order on a single screen — its details, the vendor and vehicle once placed, the advance and balance payment gates, and a timeline from indent through delivery to invoicing."
        who="Every desk can open this; only Finance can actually release the advance or balance payment shown here."
      />

      <Split
        aside={
          <>
            {order.tripId && (
              <>
                <AdvancePanel indentId={order.indentId} onReleased={load} hideOrderLink />
                <BalancePanel tripId={order.tripId} onReleased={load} hideOrderLink />
              </>
            )}

            <Panel title="Related records">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <Link href={`/indents/${order.indentId}`} className="btn btn-secondary">
                  Indent
                </Link>
                {order.tripId && (
                  <>
                    <Link href={`/trips/${order.tripId}`} className="btn btn-secondary">
                      Trip
                    </Link>
                    <Link href={`/trips/${order.tripId}/lr`} className="btn btn-secondary">
                      Lorry receipt
                    </Link>
                    <Link
                      href={`/pod/${order.tripId}/verify`}
                      className={POD_ACTIONABLE_STATUSES.includes(order.status) ? 'btn' : 'btn btn-secondary'}
                    >
                      Proof of delivery
                    </Link>
                  </>
                )}
                {order.invoiceCode && (
                  <Link href="/invoices" className="btn btn-secondary">
                    Invoice
                  </Link>
                )}
              </div>
            </Panel>
          </>
        }
      >
        <Panel title="Order" pad={false}>
          <FactList
            facts={[
              ['Client', order.clientName],
              ['Lane', order.lane],
              ['Material', order.material],
              ['Weight', `${order.weightTn} MT`],
              ['Truck type', order.truckType],
              ['Pickup date', fmtDate(order.pickupDate)],
              ['Branch', order.branchName],
              ['Freight (sell)', inr(order.sellRatePaise)],
              ['Freight (buy)', order.buyRatePaise !== null ? inr(order.buyRatePaise) : 'not awarded yet'],
            ]}
          />
        </Panel>

        {order.vendorName && (
          <Panel title="Vendor and vehicle" pad={false}>
            <FactList
              facts={[
                ['Vendor', order.vendorName],
                ['Vehicle', order.vehicleNo ?? 'not placed yet'],
                ['Driver', order.driverName ?? '—'],
              ]}
            />
          </Panel>
        )}

        {/*
          What actually happened, in the order it happened.

          This used to be ten fixed rows with a tick worked out in the browser
          — so it could only ever say "done / not done", never *when* or *who*,
          and an order that failed placement twice looked identical to one that
          sailed through. These are recorded `order_events`: one row per entry
          into a step, appended, never overwritten.
        */}
        <Panel title="🕘 What has happened so far">
          <Stack gap={0}>
            {order.events.length === 0 && (
              <div className="hint">
                Nothing recorded yet. Steps appear here as the order moves.
              </div>
            )}
            {order.events.map((m, i) => (
              <div key={m.id} style={{ display: 'flex', gap: 12, paddingBottom: i === order.events.length - 1 ? 0 : 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 'none' }}>
                  <div
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: '50%',
                      flex: 'none',
                      background: m.status === 'FAILED' ? 'var(--red)' : 'var(--mint)',
                      border: `2px solid ${m.status === 'FAILED' ? 'var(--red)' : 'var(--mint)'}`,
                    }}
                  />
                  {i < order.events.length - 1 && (
                    <div style={{ width: 2, flex: 1, minHeight: 18, background: 'var(--color-divider)', marginTop: 2 }} />
                  )}
                </div>
                <div style={{ paddingTop: 0 }}>
                  <div style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>
                    {ORDER_STATUS_LABEL[m.status]}
                  </div>
                  <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 1 }}>
                    {fmtDate(m.at)}
                    {/* "the system did this" is a real answer, so say it rather
                        than leaving the line half-written. */}
                    {` · ${m.actorName ?? 'automatic'}`}
                  </div>
                  {m.note && (
                    <div className="muted" style={{ fontSize: 'var(--text-sm)', marginTop: 1 }}>
                      {m.note}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </Stack>
        </Panel>
      </Split>
    </ModuleGuard>
  );
}
